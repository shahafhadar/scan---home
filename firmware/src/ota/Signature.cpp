#include "ota/Signature.h"

#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <string.h>

#include "ota/ota_public_key.h"
#include "platform/ErrorCodes.h"
#include "platform/Log.h"

namespace {

/**
 * Loads the compiled-in public key. `mbedtls_pk_parse_public_key` wants the
 * PEM's terminating NUL counted in the length, and silently fails to parse
 * without it -- which looks exactly like a bad key.
 */
bool loadKey(mbedtls_pk_context &pk) {
  mbedtls_pk_init(&pk);
  static const char kPem[] = OTA_PUBLIC_KEY_PEM;
  const int rc = mbedtls_pk_parse_public_key(
      &pk, reinterpret_cast<const unsigned char *>(kPem), sizeof(kPem));
  if (rc != 0) {
    mbedtls_pk_free(&pk);
    return false;
  }
  return true;
}

}  // namespace

namespace Signature {

Digest::Digest() {
  auto *ctx = new mbedtls_sha256_context();
  mbedtls_sha256_init(ctx);
  mbedtls_sha256_starts(ctx, 0);  // 0 = SHA-256 rather than SHA-224
  ctx_ = ctx;
}

Digest::~Digest() {
  auto *ctx = static_cast<mbedtls_sha256_context *>(ctx_);
  mbedtls_sha256_free(ctx);
  delete ctx;
}

void Digest::update(const uint8_t *data, size_t length) {
  mbedtls_sha256_update(static_cast<mbedtls_sha256_context *>(ctx_), data, length);
}

void Digest::finish(uint8_t out[32]) {
  mbedtls_sha256_finish(static_cast<mbedtls_sha256_context *>(ctx_), out);
}

bool verify(const uint8_t digest[32], const uint8_t *signature, size_t signatureLength) {
  if (signature == nullptr || signatureLength == 0) return false;

  mbedtls_pk_context pk;
  if (!loadKey(pk)) {
    LOG_E("sig", Err::OtaBadSignature, "the built-in public key will not parse");
    return false;
  }

  const int rc = mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, digest, 32, signature, signatureLength);
  mbedtls_pk_free(&pk);

  if (rc != 0) {
    LOG_E("sig", Err::OtaBadSignature, "signature does not match this image (-0x%04x)", -rc);
    return false;
  }
  return true;
}

bool selfTest() {
  mbedtls_pk_context pk;
  if (!loadKey(pk)) return false;
  const bool ok = mbedtls_pk_can_do(&pk, MBEDTLS_PK_ECDSA) != 0;
  mbedtls_pk_free(&pk);
  return ok;
}

}  // namespace Signature
