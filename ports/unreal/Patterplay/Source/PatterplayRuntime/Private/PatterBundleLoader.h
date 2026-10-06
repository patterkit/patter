// Parse a compiled .patterc JSON string into the engine's patter::Bundle, using UE's
// FJsonValue. The reading itself is Patter/BundleJson.h, shared with the standalone TestHost,
// which reads the same way through its own tiny parser; this supplies only the FJsonValue
// accessors and turns a throw into OutError.
#pragma once

#include "CoreMinimal.h"

namespace patter { struct Bundle; }

bool PatterLoadBundle(const FString& Json, patter::Bundle& OutBundle, FString& OutError);
