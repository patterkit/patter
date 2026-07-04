// Parse a compiled .patterc JSON string into the engine's patter::Bundle, using UE's
// FJsonObject (the standalone TestHost uses its own tiny parser instead). The engine stays
// parser-agnostic; this is the UE-side loader.
#pragma once

#include "CoreMinimal.h"

namespace patter { struct Bundle; }

bool PatterLoadBundle(const FString& Json, patter::Bundle& OutBundle, FString& OutError);
