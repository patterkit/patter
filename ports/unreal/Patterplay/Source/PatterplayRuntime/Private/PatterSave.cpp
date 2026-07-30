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
		return true;
	}
	catch (const std::exception&)
	{
		return false;
	}
}
