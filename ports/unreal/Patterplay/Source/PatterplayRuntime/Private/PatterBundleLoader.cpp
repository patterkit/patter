#include "PatterBundleLoader.h"
#include "Patter/Bundle.h"
#include "Patter/BundleJson.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "PatterConvert.h"
#include <stdexcept>

using PatterConvert::Std;

// The kernel's own namespace, since a template is specialised where it lives (the kernel is
// shared with the Storylet Engine, which reads a neutral tree instead and specialises nothing: a
// second specialisation of this one type in a game would be an ODR violation).
//
// A KNOWN RISK, recorded rather than fixed (2026-09-24). The kernel is one type across every
// plugin in a game, so this specialisation is too. A second AstJson<TSharedPtr<FJsonValue>>
// anywhere in the same game, in another plugin or in the Storylet Engine one day, is an ODR
// violation that no compiler or linker reports, and which definition runs is then anyone's guess.
// Any such specialisation belongs in the shared kernel (expr/ports/unreal), once, not here and
// not in a second plugin; move this one there before anything else needs it. See
// expr/docs/port-sharing.md, "One kernel type in Unreal".
namespace wildwinter { namespace expr
{
	/** How to read an Unreal FJsonValue, for the shared AST deserialiser. Six
	 *  accessors: everything else about deserialising is in the shared source. */
	template <>
	struct AstJson<TSharedPtr<FJsonValue>>
	{
		using J = TSharedPtr<FJsonValue>;
		static bool isArray(const J& v) { return v.IsValid() && v->Type == EJson::Array; }
		static bool isString(const J& v) { return v.IsValid() && v->Type == EJson::String; }
		static std::size_t size(const J& v) { return static_cast<std::size_t>(v->AsArray().Num()); }
		static const J& at(const J& v, std::size_t i) { return v->AsArray()[static_cast<int32>(i)]; }
		// Std() is the loader's existing FString conversion, declared above.
		static std::string str(const J& v) { return Std(v->AsString()); }
		static double num(const J& v) { return v->AsNumber(); }
		static bool boolean(const J& v) { return v->AsBool(); }
	};
}}

// The bundle reader (Patter/BundleJson.h) is the one the corpus TestHost runs, so all this loader
// supplies is the object half of reading an FJsonValue; the AstJson specialisation above covers the
// rest. Patterplay's own namespace, so unlike AstJson's this is no type another plugin shares.
namespace patter
{
	template <>
	struct BundleJson<TSharedPtr<FJsonValue>>
	{
		using J = TSharedPtr<FJsonValue>;
		static bool isObject(const J& v) { return v.IsValid() && v->Type == EJson::Object; }
		static bool isNull(const J& v) { return !v.IsValid() || v->Type == EJson::Null; }
		static bool isNumber(const J& v) { return v.IsValid() && v->Type == EJson::Number; }
		static bool isBool(const J& v) { return v.IsValid() && v->Type == EJson::Boolean; }
		static const J* find(const J& o, const char* key)
		{
			return isObject(o) ? o->AsObject()->Values.Find(FString(UTF8_TO_TCHAR(key))) : nullptr;
		}
		// FJsonObject keeps its fields in document order, which is the authored scene order.
		template <typename Fn>
		static void forEachField(const J& o, Fn&& fn)
		{
			for (const auto& KV : o->AsObject()->Values) fn(Std(KV.Key), KV.Value);
		}
	};
}

bool PatterLoadBundle(const FString& Json, patter::Bundle& Out, FString& Error)
{
	TSharedPtr<FJsonValue> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		Error = TEXT("invalid JSON");
		return false;
	}

	// A malformed or forward-version bundle throws (a missing required field, or a bad expression) and
	// becomes a clean Error here, rather than dereferencing a null TSharedPtr, which in UE is a fatal
	// check() no catch can recover from.
	try
	{
		Out = patter::parseBundle(Root);
	}
	catch (const std::exception& Ex)
	{
		Error = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}

	return true;
}
