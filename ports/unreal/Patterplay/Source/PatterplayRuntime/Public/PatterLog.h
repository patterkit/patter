// The plugin's log category. Every message the Patterplay wrapper logs (a refused call, a content error the
// engine played through, a refused save) goes here, so a game can filter it (`Log LogPatterplay Verbose`) or
// silence it apart from the rest of its log.
#pragma once

#include "CoreMinimal.h"
#include "Logging/LogMacros.h"

PATTERPLAYRUNTIME_API DECLARE_LOG_CATEGORY_EXTERN(LogPatterplay, Log, All);
