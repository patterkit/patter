#include "PatterSave.h"

#include "PatterEngine.h"
#include "Patter/Save.h"

FString UPatterSave::SaveStateToJson(UPatterEngine* Engine)
{
	if (!Engine || !Engine->Raw()) return FString();
	const std::string Json = patter::serializeState(*Engine->Raw());
	return FString(UTF8_TO_TCHAR(Json.c_str()));
}

bool UPatterSave::LoadStateFromJson(UPatterEngine* Engine, const FString& Json)
{
	if (!Engine || !Engine->Raw()) return false;
	try
	{
		patter::deserializeState(*Engine->Raw(), std::string(TCHAR_TO_UTF8(*Json)));
		// The load REBUILT the engine's flows: every wrapper the game is holding was pointing at one
		// of the old ones, which no longer exists. Re-bind them by id before anyone can call Advance.
		// A flow the save did not carry re-binds to null and reads as closed, which is the truth.
		Engine->RebindFlows();
		return true;
	}
	catch (const std::exception& Ex)
	{
		// A bare false told a Blueprint author nothing about WHY their file was refused. Note for
		// anyone writing an automation test that asserts a refusal: UE counts a logged Error as a
		// test failure, so such a test needs an AddExpectedError for this line.
		UE_LOG(LogTemp, Error, TEXT("Patterplay: refused a save file - %s"), UTF8_TO_TCHAR(Ex.what()));
		return false;
	}
}
