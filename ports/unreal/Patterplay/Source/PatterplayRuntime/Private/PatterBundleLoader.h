// Parse a compiled .patterc JSON string into the engine's patter::Bundle, using UE's
// FJsonValue (and an audio manifest likewise, since the FJsonValue accessors live in this file). The reading itself is Patter/BundleJson.h, shared with the standalone TestHost,
// which reads the same way through its own tiny parser; this supplies only the FJsonValue
// accessors and turns a throw into OutError.
#pragma once

#include "CoreMinimal.h"

namespace patter { struct Bundle; struct AudioManifest; }

bool PatterLoadBundle(const FString& Json, patter::Bundle& OutBundle, FString& OutError);

// Parse a patteraudio.json manifest string through the core's readAudioManifest (Patter/Audio.h), the
// reader the TestHost runs against the corpus, over the same FJsonValue accessors the bundle reader uses.
// False, with OutError, when the text is not JSON or its root is not an object; OutManifest is then empty.
bool PatterLoadAudioManifest(const FString& Json, patter::AudioManifest& OutManifest, FString& OutError);
