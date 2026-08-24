package com.giftedborg.xend.hardwarekey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * The approval signer's key (S2 in ADR 0025), in StrongBox where the device has
 * it and the TEE otherwise.
 *
 * StrongBox is requested, not required. Devices without it fall back to the
 * TEE, which is still hardware-backed and still satisfies the anchor. What is
 * NOT acceptable is a software key, and nothing here can tell the difference:
 * the fallback is silent. The attestation certificate the backend verifies
 * carries the real security level, and that is the only thing that decides.
 *
 * The key is generated with per-use authentication, so signing has to go
 * through BiometricPrompt with a CryptoObject. Calling `initSign` and `sign`
 * directly throws UserNotAuthenticatedException: Keystore will not let an
 * auth-bound key produce a signature that no biometric authorised. That
 * binding is the point, not an obstacle to route around.
 */
class HardwareKeyModule : Module() {
  companion object {
    /**
     * The alias used before keys were scoped to an account.
     *
     * Still read, never written. An install that enrolled under it keeps
     * working: the account whose key this is finds it through the fallback in
     * `aliasFor`, and enrolling a second account now writes its own alias
     * instead of destroying this one.
     */
    private const val LEGACY_KEY_ALIAS = "com.giftedborg.xend.approval-signer"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    /** Zero seconds of validity: authenticate for every single signature. */
    private const val AUTH_VALIDITY_SECONDS = 0
  }

  /**
   * Where this account's approval key lives.
   *
   * Scoped per account because a phone can hold more than one. On a single
   * shared alias, enrolling a second account deleted the first account's key,
   * and nothing could put it back: the key is half of a 2-of-3 signer set, and
   * replacing a signer needs two of the three, one of which is the key that
   * just went. The first account silently lost the ability to approve
   * anything, and only found out the next time it tried.
   *
   * The fallback is the migration. An install enrolled before this existed has
   * its key under the legacy alias, so an account with no scoped key of its own
   * uses that one. Whether it is the right key is not decided here: the app
   * compares the public key against the one the backend recorded at enrolment.
   */
  private fun aliasFor(account: String): String {
    if (account.isEmpty()) return LEGACY_KEY_ALIAS
    val scoped = "$LEGACY_KEY_ALIAS:$account"
    val store = keyStore()
    if (store.containsAlias(scoped)) return scoped
    if (store.containsAlias(LEGACY_KEY_ALIAS)) return LEGACY_KEY_ALIAS
    return scoped
  }

  /** Where a fresh enrolment writes. Never the legacy alias. */
  private fun enrolmentAlias(account: String): String =
    if (account.isEmpty()) LEGACY_KEY_ALIAS else "$LEGACY_KEY_ALIAS:$account"

  override fun definition() = ModuleDefinition {
    Name("HardwareKey")

    AsyncFunction("enrol") { nonce: String, account: String ->
      val alias = enrolmentAlias(account)
      // Only this account's own alias. Deleting more than that is the bug this
      // scoping exists to prevent.
      deleteKey(alias)
      generateKey(alias, nonce.toByteArray())

      val store = keyStore()
      val chain = store.getCertificateChain(alias)
        ?: throw CodedException("ERR_ATTESTATION", "no attestation chain", null)

      // Leaf first, PEM, JSON, base64. The backend walks it to a Google root
      // and reads the security level out of the leaf's extension.
      val pems = chain.joinToString(",") { certificate ->
        val body = Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)
        "\"-----BEGIN CERTIFICATE-----\\n$body\\n-----END CERTIFICATE-----\""
      }
      val attestation = Base64.encodeToString("[$pems]".toByteArray(), Base64.NO_WRAP)

      mapOf("attestation" to attestation, "publicKey" to compressedPublicKey(alias))
    }

    AsyncFunction("getPublicKey") { account: String ->
      val alias = aliasFor(account)
      if (keyStore().containsAlias(alias)) compressedPublicKey(alias) else null
    }

    // The prompt copy comes from the caller. This key signs account setup as
    // well as payments, and a Consumer told to "approve this payment" while
    // finishing onboarding is being asked to confirm something that is not
    // happening.
    AsyncFunction("sign") { payloadHex: String, title: String, reason: String, account: String, promise: Promise ->
      signWithBiometrics(aliasFor(account), payloadHex, title, reason, promise)
    }

    AsyncFunction("reset") { account: String -> deleteKey(enrolmentAlias(account)) }
  }

  /**
   * Prompts for biometrics and signs inside the authorised CryptoObject.
   *
   * The Signature handed to BiometricPrompt is the same object that comes back
   * on success. Signing with a freshly constructed one instead would defeat the
   * binding, because that object was never authorised.
   */
  private fun signWithBiometrics(
    alias: String,
    payloadHex: String,
    title: String,
    reason: String,
    promise: Promise,
  ) {
    val digest = try {
      payloadHex.hexToBytes()
    } catch (error: Exception) {
      return promise.reject(
        CodedException("ERR_PAYLOAD", "payload is not valid hex", error),
      )
    }
    if (digest.size != 32) {
      return promise.reject(
        CodedException("ERR_PAYLOAD", "payload must be a 32-byte hex digest", null),
      )
    }

    val activity = appContext.currentActivity as? FragmentActivity
      ?: return promise.reject(
        CodedException("ERR_NO_ACTIVITY", "no activity to prompt on", null),
      )

    val entry = try {
      keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry
    } catch (error: Exception) {
      null
    } ?: return promise.reject(
      CodedException("ERR_NO_KEY", "no usable approval key on this device", null),
    )

    val signature = try {
      // NONEwithECDSA: the payload is already the digest Turnkey stamps over.
      // SHA256withECDSA would hash it a second time and produce a signature
      // Turnkey rejects.
      Signature.getInstance("NONEwithECDSA").apply { initSign(entry.privateKey) }
    } catch (error: Exception) {
      return promise.reject(
        CodedException("ERR_NO_KEY", "approval key is unusable; re-enrol", error),
      )
    }

    val prompt = BiometricPrompt(
      activity,
      ContextCompat.getMainExecutor(activity),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(
          result: BiometricPrompt.AuthenticationResult,
        ) {
          val authorised = result.cryptoObject?.signature
            ?: return promise.reject(
              CodedException("ERR_SIGN", "no authorised signature", null),
            )
          try {
            authorised.update(digest)
            promise.resolve(authorised.sign().toHex())
          } catch (error: Exception) {
            promise.reject(CodedException("ERR_SIGN", "signing failed", error))
          }
        }

        override fun onAuthenticationError(code: Int, message: CharSequence) {
          promise.reject(CodedException("ERR_AUTH", message.toString(), null))
        }
      },
    )

    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .setSubtitle(reason)
      .setNegativeButtonText("Cancel")
      // Class 3 only. Class 2 biometrics cannot release a Keystore key, and
      // asking for a weaker class here would fail at CryptoObject time.
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
      .build()

    activity.runOnUiThread {
      prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
    }
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun generateKey(alias: String, challenge: ByteArray) {
    val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
      // The challenge is what ties the attestation to a nonce the backend
      // issued. Without it a captured attestation replays forever.
      .setAttestationChallenge(challenge)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(
        AUTH_VALIDITY_SECONDS,
        KeyProperties.AUTH_BIOMETRIC_STRONG,
      )
    } else {
      @Suppress("DEPRECATION")
      builder.setUserAuthenticationValidityDurationSeconds(-1)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Requested, not required: setIsStrongBoxBacked throws on devices without
      // it, so the retry below is the fallback to the TEE.
      try {
        generate(builder.setIsStrongBoxBacked(true).build())
        return
      } catch (_: Exception) {
        builder.setIsStrongBoxBacked(false)
      }
    }
    generate(builder.build())
  }

  private fun generate(spec: KeyGenParameterSpec) {
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
      .apply { initialize(spec) }
      .generateKeyPair()
  }

  private fun deleteKey(alias: String) {
    val store = keyStore()
    if (store.containsAlias(alias)) store.deleteEntry(alias)
  }

  /** SEC1 compressed: 0x02 or 0x03 by the parity of Y, then X padded to 32. */
  private fun compressedPublicKey(alias: String): String {
    val certificate = keyStore().getCertificate(alias)
      ?: throw CodedException("ERR_NO_KEY", "no approval key on this device", null)
    val point = (certificate.publicKey as ECPublicKey).w

    val x = point.affineX.toByteArray().takeLast(32).toByteArray()
    val padded = ByteArray(32)
    System.arraycopy(x, 0, padded, 32 - x.size, x.size)

    val prefix: Byte = if (point.affineY.testBit(0)) 0x03 else 0x02
    return (byteArrayOf(prefix) + padded).toHex()
  }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

private fun String.hexToBytes(): ByteArray {
  require(length % 2 == 0) { "hex string must have an even length" }
  return chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
