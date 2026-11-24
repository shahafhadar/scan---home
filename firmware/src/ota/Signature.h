#pragma once
#include <stddef.h>
#include <stdint.h>

/**
 * Verifies that a firmware image was signed by us.
 *
 * ECDSA over P-256, signature computed on the SHA-256 of the image. The public
 * key is compiled in (ota_public_key.h); the private key lives on one machine
 * and is never checked in.
 *
 * The reason this exists: `Update.end()` verifies a checksum, and a checksum
 * only proves the bytes arrived intact. It says nothing about who sent them.
 * Anyone able to answer for our hostname -- a poisoned DNS cache, a hostile
 * network, a server we lose control of -- could otherwise install arbitrary
 * firmware on every device in the field. A signature moves the trust from the
 * network to a key we hold.
 */
namespace Signature {

/** Streaming SHA-256 over an image as it is written to flash. */
class Digest {
 public:
  Digest();
  ~Digest();
  void update(const uint8_t *data, size_t length);
  /** Fills `out` with 32 bytes. Safe to call once. */
  void finish(uint8_t out[32]);

 private:
  void *ctx_;
};

/**
 * True only if `signature` is a DER-encoded ECDSA signature over `digest`,
 * made with the private key matching the compiled-in public key.
 *
 * Every failure -- a malformed key, a malformed signature, a mismatch --
 * returns false. There is no path through this function that accepts an image
 * because something went wrong while checking it.
 */
bool verify(const uint8_t digest[32], const uint8_t *signature, size_t signatureLength);

/** Parses the compiled-in key. Called at boot so a broken key is found early. */
bool selfTest();

}  // namespace Signature
