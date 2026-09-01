// mulberry32 - the seeded PRNG behind random() / shuffle. The algorithm is the
// SHARED source, vendored from expr/ports/unreal/Mulberry32.h to
// Expr/Mulberry32.h beside this; it lands in the `patter` namespace.
//
// The state is reached through state() / setState() rather than a public field,
// which is what the Storylet Engine's copy always did and what the JS `state()`
// spells. Engine.h used to inline the mixing rather than use this class at all.
#pragma once

#include "Patter/Expr/Mulberry32.h"
