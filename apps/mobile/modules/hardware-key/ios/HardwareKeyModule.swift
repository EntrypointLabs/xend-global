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
  /// The tag used before keys were scoped to an account. Still read, never written.
  private static let legacyKeyTag = "com.giftedborg.xend.approval-signer"

  /// Where this account's approval key lives.
  ///
  /// Scoped per account because a phone can hold more than one. On a single
  /// shared tag, enrolling a second account deleted the first account's key,
  /// and nothing could put it back: the key is half of a 2-of-3 signer set, and
  /// replacing a signer needs two of the three, one of which is the key that
  /// just went.
  ///
  /// The fallback is the migration. An install enrolled before this existed has
  /// its key under the legacy tag, so an account with no scoped key of its own
  /// uses that one. Whether it is the right key is settled by the app, which
  /// compares it against the public key the backend recorded at enrolment.
  private static func tag(for account: String) -> Data {
    if account.isEmpty { return legacyKeyTag.data(using: .utf8)! }
    let scoped = "\(legacyKeyTag):\(account)"
    if exists(tag: scoped) { return scoped.data(using: .utf8)! }
    if exists(tag: legacyKeyTag) { return legacyKeyTag.data(using: .utf8)! }
    return scoped.data(using: .utf8)!
  }

  /// Where a fresh enrolment writes. Never the legacy tag.
  private static func enrolmentTag(for account: String) -> Data {
    let value = account.isEmpty ? legacyKeyTag : "\(legacyKeyTag):\(account)"
    return value.data(using: .utf8)!
  }

  private static func exists(tag: String) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
      kSecReturnRef as String: false,
    ]
    return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
  }
  private static let sentinelKey = "com.giftedborg.xend.approval-signer.enrolled"
  private static let attestKeyDefault = "com.giftedborg.xend.appattest.keyid"

  public func definition() -> ModuleDefinition {
    Name("HardwareKey")

    AsyncFunction("enrol") { (nonce: String, account: String, promise: Promise) in
      do {
        try self.deleteKey(account: account, forEnrolment: true)
        UserDefaults.standard.removeObject(forKey: Self.attestKeyDefault)

        let privateKey = try self.createKey(account: account)
        let publicKey = try self.compressedPublicKey(from: privateKey)

        // The challenge commits to the Secure Enclave key. iOS has two keys
        // here and only one of them can do each job: App Attest owns its own
        // key and will not sign a Turnkey stamp, while the Secure Enclave key
        // signs stamps but cannot be attested. Attesting over the pair is what
        // lets the backend enrol the key that will actually stamp, instead of
        // the App Attest key the app never uses again.
        self.attest(nonce: nonce, boundTo: publicKey) { result in
          switch result {
          case .success(let attestation):
            UserDefaults.standard.set(true, forKey: Self.sentinelKey)
            promise.resolve(["attestation": attestation, "publicKey": publicKey])
          case .failure(let error):
            // Never leave a key the backend has not accepted.
            try? self.deleteKey(account: account, forEnrolment: true)
            promise.reject("ERR_ATTESTATION", error.localizedDescription)
          }
        }
      } catch {
        promise.reject("ERR_ENROL", error.localizedDescription)
      }
    }

    AsyncFunction("getPublicKey") { (account: String) -> String? in
      guard let key = try? self.loadKey(account: account) else { return nil }
      return try? self.compressedPublicKey(from: key)
    }

    // The prompt copy comes from the caller. This key signs account setup as
    // well as payments, and a Consumer told to "approve this payment" while
    // finishing onboarding is being asked to confirm something that is not
    // happening. `title` is unused here: iOS shows a single reason line.
    AsyncFunction("sign") { (payloadHex: String, title: String, reason: String, account: String) -> String in
      _ = title
      guard let digest = Data(hex: payloadHex), digest.count == 32 else {
        throw Exception(name: "ERR_PAYLOAD", description: "payload must be a 32-byte hex digest")
      }
      let key = try self.loadKey(account: account, reason: reason)

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

    AsyncFunction("reset") { (account: String) in
      try? self.deleteKey(account: account, forEnrolment: true)
      UserDefaults.standard.removeObject(forKey: Self.sentinelKey)
      UserDefaults.standard.removeObject(forKey: Self.attestKeyDefault)
    }
  }

  // MARK: - Key material

  private func createKey(account: String) throws -> SecKey {
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
        kSecAttrApplicationTag as String: Self.enrolmentTag(for: account),
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

  private func loadKey(account: String, reason: String = "Approve this payment") throws -> SecKey {
    // Fresh context per call. A retained one can satisfy a later operation with
    // an earlier prompt.
    let context = LAContext()
    context.localizedReason = reason

    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Self.tag(for: account),
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

  /// Only this account's own tag. Deleting more than that is the bug the
  /// scoping exists to prevent.
  private func deleteKey(account: String, forEnrolment: Bool = false) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: forEnrolment
        ? Self.enrolmentTag(for: account) : Self.tag(for: account),
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

  private func attest(
    nonce: String,
    boundTo publicKey: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
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

      // Apple hashes the challenge into the attestation, so the backend
      // recomputes SHA256(authData || SHA256(nonce || publicKey)). The public
      // key inside the hash is what binds the attestation to the Secure Enclave
      // key: a client that sent a different one would not match.
      let clientDataHash = Data((nonce + publicKey).utf8).sha256()
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
