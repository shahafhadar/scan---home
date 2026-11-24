#pragma once
#include <stdint.h>

/**
 * One code per kind of fault, used everywhere: logs, heartbeat, diagnostics.
 *
 * Free-text errors cannot be counted, grouped or alerted on. A device in
 * someone's kitchen reports E002 forty times in an hour and that is a story;
 * forty slightly different sentences are not.
 */
enum class Err : uint16_t {
  None = 0,

  WifiConnectFailed = 1,   // E001 -- no association with the access point
  WifiNoInternet    = 2,   // E002 -- associated, but nothing beyond the router
  ServerUnreachable = 3,   // E003 -- internet is up, our server is not
  ServerTimeout     = 4,   // E004 -- connected, no answer in time
  ServerRejected    = 5,   // E005 -- answered, and refused us
  BadResponse       = 6,   // E006 -- answered with something unparseable
  StorageFailure    = 7,   // E007 -- filesystem or NVS refused
  QueueFull         = 8,   // E008 -- the offline queue hit its ceiling
  QueuePoisoned     = 9,   // E009 -- an entry the server will never accept
  ScannerLost       = 10,  // E010 -- no scanner where one is expected
  ScannerBadInput   = 11,  // E011 -- something arrived that is not a barcode
  TimeSyncFailed    = 12,  // E012 -- no clock, so TLS cannot be verified
  OtaFailed         = 13,  // E013
  ConfigInvalid     = 14,  // E014 -- stored config did not survive validation
  OutOfMemory       = 15,  // E015

  OtaBadSignature   = 16,  // E016 -- an image that we did not sign
  OtaRolledBack     = 17,  // E017 -- a new image failed to prove itself
  ResponseTooLarge  = 18,  // E018 -- the server sent more than we will read
};

/** "E007". Fixed width so logs line up and greps are simple. */
const char *errCode(Err error);

/** Short human text, for the console. The code is what machines read. */
const char *errText(Err error);
