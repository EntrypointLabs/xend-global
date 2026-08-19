import CommonCrypto
import DeviceCheck
import ExpoModulesCore
import LocalAuthentication
import Security

/**
 The approval signer's key, held in the Secure Enclave and gated on biometrics.

 Three things here are deliberate and easy to undo by accident:

 - A fresh `LAContext` is built at every call site and the `SecKey` is never
   cached. Retaining either can collapse the biometric prompt across operations,
   which Apple has neither confirmed nor denied, so the prompt is treated as a
   UX affordance rather than the security boundary.
 - A first-run sentinel lives in `UserDefaults`, which *is* cleared on
   uninstall, because Keychain survival across uninstall is explicitly not part
   of Apple's contract and has flipped between releases. Depending on either
   survival or deletion would strand a key the backend no longer knows about.
 - An authentication or decryption failure on lookup is handled exactly like
   `errSecItemNotFound`. Removing the device passcode discards the class keys
   and leaves items present but undecryptable; retrying that forever is worse
   than re-enrolling.
 */
public class HardwareKeyModule: Module {
  private static let keyTag = "com.giftedborg.xend.approval-signer".data(using: .utf8)!
  private static let sentinelKey = "com.giftedborg.xend.approval-signer.enrolled"
  private static let attestKeyDefault = "com.giftedborg.xend.appattest.keyid"

  public func definition() -> ModuleDefinition {
    Name("HardwareKey")

    AsyncFunction("enrol") { (nonce: String, promise: Promise) in
      do {
        try self.deleteKey()
        UserDefaults.standard.removeObject(forKey: Self.attestKeyDefault)

        let privateKey = try self.createKey()
        let publicKey = try self.compressedPublicKey(from: privateKey)

        self.attest(nonce: nonce) { result in
          switch result {
          case .success(let attestation):
            UserDefaults.standard.set(true, forKey: Self.sentinelKey)
            promise.resolve(["attestation": attestation, "publicKey": publicKey])
          case .failure(let error):
            // Never leave a key the backend has not accepted.
            try? self.deleteKey()
            promise.reject("ERR_ATTESTATION", error.localizedDescription)
          }
        }
      } catch {
        promise.reject("ERR_ENROL", error.localizedDescription)
      }
    }

    AsyncFunction("getPublicKey") { () -> String? in
      guard let key = try? self.loadKey() else { return nil }
      return try? self.compressedPublicKey(from: key)
    }

    // The prompt copy comes from the caller. This key signs account setup as
    // well as payments, and a Consumer told to "approve this payment" while
    // finishing onboarding is being asked to confirm something that is not
    // happening. `title` is unused here: iOS shows a single reason line.
    AsyncFunction("sign") { (payloadHex: String, title: String, reason: String) -> String in
      _ = title
      guard let digest = Data(hex: payloadHex), digest.count == 32 else {
        throw Exception(name: "ERR_PAYLOAD", description: "payload must be a 32-byte hex digest")
      }
      let key = try self.loadKey(reason: reason)

      var error: Unmanaged<CFError>?
      guard
        let signature = SecKeyCreateSignature(
          key, .ecdsaSignatureDigestX962SHA256, digest as CFData, &error)
      else {
        throw Exception(
          name: "ERR_SIGN",
          description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "sign failed")
      }
      return (signature as Data).hexString
    }

    AsyncFunction("reset") { () in
      try? self.deleteKey()
      UserDefaults.standard.removeObject(forKey: Self.sentinelKey)
      UserDefaults.standard.removeObject(forKey: Self.attestKeyDefault)
    }
  }

  // MARK: - Key material

  private func createKey() throws -> SecKey {
    var accessError: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        nil,
        // ...ThisDeviceOnly so the key cannot ride a backup to another device,
        // which would break the "physical possession" anchor outright.
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        [.privateKeyUsage, .biometryCurrentSet],
        &accessError)
    else {
      throw Exception(
        name: "ERR_ACCESS_CONTROL",
        description: (accessError?.takeRetainedValue() as Error?)?.localizedDescription ?? "unknown")
    }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: Self.keyTag,
        kSecAttrAccessControl as String: access,
      ],
    ]

    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw Exception(
        name: "ERR_KEYGEN",
        description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "unknown")
    }
    return key
  }

  private func loadKey(reason: String = "Approve this payment") throws -> SecKey {
    // Fresh context per call. A retained one can satisfy a later operation with
    // an earlier prompt.
    let context = LAContext()
    context.localizedReason = reason

    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Self.keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
      kSecUseAuthenticationContext as String: context,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    // errSecAuthFailed and errSecDecode mean the item is present but unusable,
    // which for our purposes is the same as absent: re-enrol, do not retry.
    if status == errSecItemNotFound || status == errSecAuthFailed || status == errSecDecode {
      throw Exception(name: "ERR_NO_KEY", description: "no usable approval key on this device")
    }
    guard status == errSecSuccess, let key = item else {
      throw Exception(name: "ERR_KEYCHAIN", description: "keychain lookup failed (\(status))")
    }
    // swiftlint:disable:next force_cast
    return (key as! SecKey)
  }

  private func deleteKey() throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Self.keyTag,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw Exception(name: "ERR_KEYCHAIN", description: "could not delete the key (\(status))")
    }
  }

  private func compressedPublicKey(from privateKey: SecKey) throws -> String {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw Exception(name: "ERR_PUBKEY", description: "could not derive the public key")
    }
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw Exception(
        name: "ERR_PUBKEY",
        description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "unknown")
    }
    // X9.63 uncompressed: 0x04 || X || Y. Turnkey wants SEC1 compressed.
    guard data.count == 65, data[0] == 0x04 else {
      throw Exception(name: "ERR_PUBKEY", description: "unexpected public key encoding")
    }
    let x = data.subdata(in: 1..<33)
    let y = data.subdata(in: 33..<65)
    let prefix: UInt8 = (y[y.count - 1] & 1) == 0 ? 0x02 : 0x03
    return (Data([prefix]) + x).hexString
  }

  // MARK: - Attestation

  private func attest(nonce: String, completion: @escaping (Result<String, Error>) -> Void) {
    let service = DCAppAttestService.shared
    guard service.isSupported else {
      completion(
        .failure(
          Exception(
            name: "ERR_UNSUPPORTED",
            description: "App Attest is unavailable on this device")))
      return
    }

    service.generateKey { keyId, error in
      if let error { return completion(.failure(error)) }
      guard let keyId else {
        return completion(
          .failure(Exception(name: "ERR_ATTESTATION", description: "no App Attest key")))
      }
      UserDefaults.standard.set(keyId, forKey: Self.attestKeyDefault)

      // Apple hashes the challenge itself into the attestation; we pass the
      // raw nonce so the backend can recompute SHA256(authData || SHA256(nonce)).
      let clientDataHash = Data(nonce.utf8).sha256()
      service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
        if let error { return completion(.failure(error)) }
        guard let attestation else {
          return completion(
            .failure(Exception(name: "ERR_ATTESTATION", description: "empty attestation")))
        }
        completion(.success(attestation.base64EncodedString()))
      }
    }
  }
}

extension Data {
  var hexString: String { map { String(format: "%02x", $0) }.joined() }

  init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var bytes = [UInt8]()
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }

  func sha256() -> Data {
    var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    withUnsafeBytes { buffer in
      _ = CC_SHA256(buffer.baseAddress, CC_LONG(count), &digest)
    }
    return Data(digest)
  }
}
