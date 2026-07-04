#include "PatterBundleLoader.h"
#include "Patter/Bundle.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include <stdexcept>

using patter::Bundle;
using patter::PatterValue;

namespace
{
	std::string Std(const FString& S) { return std::string(TCHAR_TO_UTF8(*S)); }

	const TSharedPtr<FJsonValue>* Field(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		return O->Values.Find(Key);
	}

	// Required-field accessors: a malformed / forward-version bundle throws std::runtime_error (caught by
	// PatterLoadBundle's try/catch -> a clean Error) instead of dereferencing a null TSharedPtr, which in
	// UE is a fatal check() the catch can't recover from.
	[[noreturn]] void Missing(const TCHAR* Key) { throw std::runtime_error(std::string("bundle: missing/invalid field '") + TCHAR_TO_UTF8(Key) + "'"); }

	TSharedPtr<FJsonObject> ReqObject(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		const TSharedPtr<FJsonValue>* P = O->Values.Find(Key);
		if (!P || !P->IsValid()) Missing(Key);
		TSharedPtr<FJsonObject> Obj = (*P)->AsObject();
		if (!Obj.IsValid()) Missing(Key);
		return Obj;
	}

	const TArray<TSharedPtr<FJsonValue>>& ReqArray(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		const TSharedPtr<FJsonValue>* P = O->Values.Find(Key);
		if (!P || !P->IsValid() || (*P)->Type != EJson::Array) Missing(Key);
		return (*P)->AsArray();
	}

	std::string ReqString(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		const TSharedPtr<FJsonValue>* P = O->Values.Find(Key);
		if (!P || !P->IsValid()) Missing(Key);
		return std::string(TCHAR_TO_UTF8(*(*P)->AsString()));
	}

	PatterValue ToValue(const TSharedPtr<FJsonValue>& V)
	{
		switch (V->Type)
		{
			case EJson::Boolean: return PatterValue::Bool(V->AsBool());
			case EJson::Number: return PatterValue::Num(V->AsNumber());
			case EJson::String: return PatterValue::Str(Std(V->AsString()));
			case EJson::Array:
			{
				std::vector<std::string> F;
				for (const TSharedPtr<FJsonValue>& X : V->AsArray()) F.push_back(Std(X->AsString()));
				return PatterValue::Flags(F);
			}
			default: return PatterValue::Bool(false);
		}
	}

	std::shared_ptr<patter::GameData> ToGameData(const TSharedPtr<FJsonObject>& O)
	{
		auto Gd = std::make_shared<patter::GameData>();
		for (const auto& KV : O->Values) (*Gd)[Std(KV.Key)] = ToValue(KV.Value);
		return Gd;
	}

	std::vector<std::string> StrList(const TSharedPtr<FJsonValue>& V)
	{
		std::vector<std::string> Out;
		for (const TSharedPtr<FJsonValue>& X : V->AsArray()) Out.push_back(Std(X->AsString()));
		return Out;
	}

	patter::AstPtr ToAst(const TSharedPtr<FJsonValue>& V)
	{
		if (!V.IsValid() || V->Type != EJson::Array) throw std::runtime_error("bundle: expression node is not a tagged array");
		const TArray<TSharedPtr<FJsonValue>>& A = V->AsArray();
		if (A.Num() < 1) throw std::runtime_error("bundle: empty expression node");
		std::string Tag = Std(A[0]->AsString());
		// Each tag has a fixed arity; a forward-version / corrupt node with too few elements would index
		// out of bounds, and an unknown tag would silently evaluate as false - so reject both.
		auto Arity = [&](int32 N) { if (A.Num() < N) throw std::runtime_error("bundle: malformed '" + Tag + "' expression node"); };
		auto N = std::make_shared<patter::AstNode>();
		if (Tag == "b") { Arity(2); N->tag = patter::AstTag::Bool; N->b = A[1]->AsBool(); }
		else if (Tag == "n") { Arity(2); N->tag = patter::AstTag::Number; N->n = A[1]->AsNumber(); }
		else if (Tag == "s") { Arity(2); N->tag = patter::AstTag::Str; N->s = Std(A[1]->AsString()); }
		else if (Tag == "sv") { Arity(3); N->tag = patter::AstTag::ScopedVar; N->scope = Std(A[1]->AsString()); N->name = Std(A[2]->AsString()); }
		else if (Tag == "u") { Arity(3); N->tag = patter::AstTag::Unary; N->op = Std(A[1]->AsString()); N->operand = ToAst(A[2]); }
		else if (Tag == "bin") { Arity(4); N->tag = patter::AstTag::Binary; N->op = Std(A[1]->AsString()); N->left = ToAst(A[2]); N->right = ToAst(A[3]); }
		else if (Tag == "fd") { Arity(3); N->tag = patter::AstTag::FlagDelta; N->sign = Std(A[1]->AsString()); N->name = Std(A[2]->AsString()); }
		else if (Tag == "call") { Arity(2); N->tag = patter::AstTag::Call; N->fn = Std(A[1]->AsString()); for (int32 i = 2; i < A.Num(); ++i) N->args.push_back(ToAst(A[i])); }
		else throw std::runtime_error("bundle: unknown expression tag '" + Tag + "'");
		return N;
	}

	patter::Expression ToExpr(const TSharedPtr<FJsonObject>& O) { patter::Expression E; E.ast = ToAst(O->Values.FindRef(TEXT("ast"))); return E; }

	std::vector<patter::Effect> ToEffects(const TSharedPtr<FJsonValue>& V)
	{
		std::vector<patter::Effect> Out;
		for (const TSharedPtr<FJsonValue>& X : V->AsArray())
		{
			TSharedPtr<FJsonObject> O = X->AsObject();
			patter::Effect E; E.target = Std(O->Values.FindRef(TEXT("target"))->AsString()); E.value = ToExpr(O->Values.FindRef(TEXT("value"))->AsObject());
			Out.push_back(E);
		}
		return Out;
	}

	patter::PropertyDecl ToPropDecl(const TSharedPtr<FJsonObject>& O)
	{
		patter::PropertyDecl D;
		D.name = Std(O->Values.FindRef(TEXT("name"))->AsString());
		D.type = Std(O->Values.FindRef(TEXT("type"))->AsString());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("shared"))) { D.hasShared = true; D.shared = (*P)->AsBool(); }
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("temporary"))) D.temporary = (*P)->AsBool();
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("default"))) { D.hasDefault = true; D.def = ToValue(*P); }
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("values"))) D.values = StrList(*P);
		return D;
	}

	patter::Beat ToBeat(const TSharedPtr<FJsonObject>& O)
	{
		patter::Beat B;
		B.id = Std(O->Values.FindRef(TEXT("id"))->AsString());
		B.kind = Std(O->Values.FindRef(TEXT("kind"))->AsString());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("character"))) B.character = Std((*P)->AsString());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("direction"))) B.direction = Std((*P)->AsString());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("gameData"))) B.gameData = ToGameData((*P)->AsObject());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("tags"))) B.tags = StrList(*P);   // author tags (#215)
		return B;
	}

	patter::NodePtr ToNode(const TSharedPtr<FJsonObject>& O)
	{
		auto N = std::make_shared<patter::Node>();
		N->id = Std(O->Values.FindRef(TEXT("id"))->AsString());
		N->type = Std(O->Values.FindRef(TEXT("type"))->AsString());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("condition"))) N->condition = std::make_shared<patter::Expression>(ToExpr((*P)->AsObject()));
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("onEnter"))) N->onEnter = ToEffects(*P);
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("onExit"))) N->onExit = ToEffects(*P);
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("gameData"))) N->gameData = ToGameData((*P)->AsObject());
		if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("tags"))) N->tags = StrList(*P);   // author tags (#215)

		if (N->isGroup())
		{
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("selector"))) N->selector = Std((*P)->AsString());
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("children"))) for (const auto& C : (*P)->AsArray()) N->children.push_back(ToNode(C->AsObject()));
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("prompt"))) N->prompt = std::make_shared<patter::Beat>(ToBeat((*P)->AsObject()));
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("sticky"))) N->sticky = (*P)->AsBool();
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("fallback"))) N->fallback = (*P)->AsBool();
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("secretUntilEligible"))) N->secretUntilEligible = (*P)->AsBool();
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("shared"))) N->shared = (*P)->AsBool();
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("options")))
			{
				TSharedPtr<FJsonObject> Op = (*P)->AsObject();
				N->options = std::make_shared<patter::SelectorOptions>();
				if (const TSharedPtr<FJsonValue>* Q = Field(Op, TEXT("order"))) N->options->order = Std((*Q)->AsString());
				if (const TSharedPtr<FJsonValue>* Q = Field(Op, TEXT("exhaust"))) N->options->exhaust = Std((*Q)->AsString());
			}
		}
		else
		{
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("beats"))) for (const auto& Bt : (*P)->AsArray()) N->beats.push_back(ToBeat(Bt->AsObject()));
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("jump")))
			{
				TSharedPtr<FJsonObject> J = (*P)->AsObject();
				N->jump = std::make_shared<patter::Jump>();
				N->jump->to = Std(J->Values.FindRef(TEXT("to"))->AsString());
				if (const TSharedPtr<FJsonValue>* Q = Field(J, TEXT("mode"))) N->jump->mode = Std((*Q)->AsString());
			}
		}
		return N;
	}

	std::map<std::string, std::map<std::string, std::string>> ToStrings(const TSharedPtr<FJsonObject>& O)
	{
		std::map<std::string, std::map<std::string, std::string>> Out;
		for (const auto& Loc : O->Values)
		{
			std::map<std::string, std::string> T;
			for (const auto& KV : Loc.Value->AsObject()->Values) T[Std(KV.Key)] = Std(KV.Value->AsString());
			Out[Std(Loc.Key)] = T;
		}
		return Out;
	}
}

bool PatterLoadBundle(const FString& Json, Bundle& Out, FString& Error)
{
	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		Error = TEXT("invalid JSON");
		return false;
	}

	try
	{
		if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("voiced"))) Out.voiced = (*P)->AsBool();
			if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("content")))
			{
				const TSharedPtr<FJsonObject> Ct = (*P)->AsObject();
				if (Ct.IsValid())
				{
					if (const TSharedPtr<FJsonValue>* H = Field(Ct, TEXT("hash"))) Out.contentHash = Std((*H)->AsString());
					if (const TSharedPtr<FJsonValue>* Sh = Field(Ct, TEXT("structureHash"))) Out.structureHash = Std((*Sh)->AsString());
					if (const TSharedPtr<FJsonValue>* Pr = Field(Ct, TEXT("project"))) Out.contentProject = Std((*Pr)->AsString());
				}
			}
			if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("localisation")))
			{
				const TSharedPtr<FJsonObject> Lz = (*P)->AsObject();
				if (const TSharedPtr<FJsonValue>* M = Field(Lz, TEXT("mode"))) Out.localisation.mode = Std((*M)->AsString());
				if (const TSharedPtr<FJsonValue>* SD = Field(Lz, TEXT("sourceDebug"))) Out.localisation.sourceDebug = (*SD)->AsBool();
			}

		TSharedPtr<FJsonObject> Loc = ReqObject(Root, TEXT("locales"));
		Out.locales.defaultLocale = ReqString(Loc, TEXT("default"));
		if (const TSharedPtr<FJsonValue>* P = Field(Loc, TEXT("included"))) Out.locales.included = StrList(*P);

		if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("cast")))
			for (const auto& C : (*P)->AsArray())
			{
				TSharedPtr<FJsonObject> O = C->AsObject();
				patter::Cast Cc; Cc.name = Std(O->Values.FindRef(TEXT("name"))->AsString());
				if (const TSharedPtr<FJsonValue>* Q = Field(O, TEXT("displayName"))) Cc.displayName = Std((*Q)->AsString());
				Out.cast.push_back(Cc);
			}

		if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("properties")))
			for (const auto& Pr : (*P)->AsArray()) Out.properties.push_back(ToPropDecl(Pr->AsObject()));

		if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("strings"))) Out.strings = ToStrings((*P)->AsObject());

		if (const TSharedPtr<FJsonValue>* P = Field(Root, TEXT("gameDataFields")))
			for (const auto& Kind : (*P)->AsObject()->Values)
			{
				std::vector<patter::GameDataField> Fields;
				for (const auto& F : Kind.Value->AsArray())
				{
					TSharedPtr<FJsonObject> O = F->AsObject();
					patter::GameDataField Gf; Gf.name = Std(O->Values.FindRef(TEXT("name"))->AsString());
					if (const TSharedPtr<FJsonValue>* Q = Field(O, TEXT("type"))) Gf.type = Std((*Q)->AsString());
					if (const TSharedPtr<FJsonValue>* Q = Field(O, TEXT("default"))) { Gf.hasDefault = true; Gf.def = ToValue(*Q); }
					if (const TSharedPtr<FJsonValue>* Q = Field(O, TEXT("values"))) Gf.values = StrList(*Q);
					Fields.push_back(Gf);
				}
				Out.gameDataFields[Std(Kind.Key)] = Fields;
			}

		for (const auto& Sc : ReqObject(Root, TEXT("scenes"))->Values)
		{
			TSharedPtr<FJsonObject> O = Sc.Value->AsObject();
			if (!O.IsValid()) Missing(TEXT("scene"));
			patter::Scene Scene; Scene.id = ReqString(O, TEXT("id"));
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("name"))) Scene.name = Std((*P)->AsString());
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("gameId"))) Scene.gameId = Std((*P)->AsString());
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("tags"))) Scene.tags = StrList(*P);   // author tags (#215)
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("sceneProps"))) for (const auto& Pr : (*P)->AsArray()) Scene.sceneProps.push_back(ToPropDecl(Pr->AsObject()));
			if (const TSharedPtr<FJsonValue>* P = Field(O, TEXT("onEntry"))) Scene.onEntry = ToEffects(*P);
			for (const auto& Blk : ReqArray(O, TEXT("blocks")))
			{
				TSharedPtr<FJsonObject> Bo = Blk->AsObject();
				if (!Bo.IsValid()) Missing(TEXT("block"));
				patter::Block Block; Block.id = ReqString(Bo, TEXT("id"));
				if (const TSharedPtr<FJsonValue>* P = Field(Bo, TEXT("name"))) Block.name = Std((*P)->AsString());
				if (const TSharedPtr<FJsonValue>* P = Field(Bo, TEXT("gameId"))) Block.gameId = Std((*P)->AsString());
				if (const TSharedPtr<FJsonValue>* P = Field(Bo, TEXT("tags"))) Block.tags = StrList(*P);   // author tags (#215)
				if (const TSharedPtr<FJsonValue>* P = Field(Bo, TEXT("children"))) for (const auto& C : (*P)->AsArray()) Block.children.push_back(ToNode(C->AsObject()));
				Scene.blocks.push_back(std::move(Block));
			}
			Out.scenes[Std(Sc.Key)] = std::move(Scene);
		}
	}
	catch (const std::exception& Ex)
	{
		Error = FString(UTF8_TO_TCHAR(Ex.what()));
		return false;
	}

	return true;
}
