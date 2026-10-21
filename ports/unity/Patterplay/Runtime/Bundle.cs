// The compiled-bundle model (a parsed .patterc). Plain data classes so any JSON
// library can populate them (the Unity package uses Newtonsoft; the dotnet TestHost
// uses System.Text.Json) - the Runtime stays parser-agnostic. Mirrors @patterkit/model's
// Bundle / Scene / Block / node / Beat / Jump / Expression / Effect shapes.

using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public sealed class Bundle
    {
        /// <summary>The built-in `padAfter`, in seconds, for a project that sets no default of its own (line
        /// padding): the same on every runtime and in Patterpad's Play window.</summary>
        public const double DefaultPadAfter = 0.6;
        /// <summary>The speaker pattern a project starts with, for a bundle that ships none: `You (V.O.)`.
        /// `{name}` and `{qualifier}` are plain placeholders, never run through line interpolation.</summary>
        internal const string DefaultSpeakerPattern = "{name} ({qualifier})";

        /// <summary>The bundle schema tag ("patter/bundle@0"). Null if absent (an older compiler).</summary>
        public string Schema;
        public bool Voiced;
        /// <summary>content.hash - the build identity (live-link stale-build check). Null if absent.</summary>
        public string ContentHash;
        /// <summary>content.structureHash - the same fingerprint minus the strings: equal + a different
        /// ContentHash = a text-only edit (live refresh tier 1). Null if absent (an older compiler).</summary>
        public string StructureHash;
        /// <summary>content.project - optional project name.</summary>
        public string ContentProject;
        /// <summary>content.version - the authored bundle version, if the project stamps one.</summary>
        public string ContentVersion;
        public Locales Locales = new Locales();
        public List<Cast> Cast = new List<Cast>();
        /// <summary>The speaker qualifiers the content uses (`gameId` + authored name), in the project's order.
        /// Empty when no line has one (an older bundle carries none).</summary>
        public List<Qualifier> Qualifiers = new List<Qualifier>();
        /// <summary>The project's speaker pattern, how a qualified speaker's label reads (`{name} ({qualifier})`
        /// filled in): the unlocalised fallback for the `speaker:pattern` string. Null when the project keeps the
        /// default or uses no qualifiers.</summary>
        public string SpeakerPattern;
        /// <summary>The project's own `padAfterDefault` (line padding); null = <see cref="DefaultPadAfter"/>.</summary>
        public double? PadAfterDefault;
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        public Dictionary<string, Scene> Scenes = new Dictionary<string, Scene>();
        /// <summary>locale -> (string id -> text). Empty for an IDs-only build (the engine emits beat IDs).</summary>
        public Dictionary<string, Dictionary<string, string>> Strings = new Dictionary<string, Dictionary<string, string>>();
        /// <summary>How strings ship + resolve (spec §11). Null = "embedded" (the default).</summary>
        public Localisation Localisation;
        /// <summary>node kind -> declared gameData fields.</summary>
        public Dictionary<string, List<GameDataField>> GameDataFields = new Dictionary<string, List<GameDataField>>();
        /// <summary>Closed-caption delimiters (#214). Null = the default ( / ).</summary>
        public CaptionDelimiters ClosedCaptions;
        /// <summary>Declared host scopes (`@world`), or null for a project that declares none.</summary>
        public HostScopeRegistry ScopeRegistry;
        /// <summary>Other engines' game-wide scopes the content names (`story`), sorted: the family's shared
        /// vocabulary, never self-backed. The engine reports when the game has not registered one. Null when
        /// the content names none.</summary>
        public List<string> ExternalScopes;
        /// <summary>The Patter extensions the project takes, by id: each one's version, its compiled declarations
        /// by node kind (every default resolved), and the project node's own values. A node's values sit on the
        /// node, under Extensions. Null when the project takes none.</summary>
        public OrderedMap<string, BundleExtension> Extensions;
    }

    /// <summary>One Patter extension as the bundle carries it.</summary>
    public sealed class BundleExtension
    {
        public string Version;
        /// <summary>Compiled declarations by node kind (project, scene, block, snippet, line, text, gameEvent,
        /// option): no editor-only fields, no editor words.</summary>
        public OrderedMap<string, List<ExtensionFieldDecl>> Fields = new OrderedMap<string, List<ExtensionFieldDecl>>();
        /// <summary>The project node's values, raw; null when it has none.</summary>
        public OrderedMap<string, object> Project;
    }

    /// <summary>A compiled extension field declaration. Default is always present in a decl and may be any
    /// JSON, held as the neutral tree (so a JSON null default is a null here). Structured types carry their
    /// parts: Fields for a record, Key and Of for a map, Of and IdField for a list, To for a reference. The
    /// engine reads none of it; the helpers read Name and Default.</summary>
    public sealed class ExtensionFieldDecl
    {
        /// <summary>Null on a map's or list's element declaration (Of).</summary>
        public string Name;
        public string Type;
        public object Default;
        /// <summary>False only on an element declaration (Of) that left its default out.</summary>
        public bool HasDefault;
        public List<string> Values;
        public List<string> Stages;
        public string To;
        public List<ExtensionFieldDecl> Fields;
        public ExtensionKeyDecl Key;
        public ExtensionFieldDecl Of;
        /// <summary>A list's identity field (the bundle's `id`).</summary>
        public string IdField;
        public double? Min;
        public double? Max;
        public bool? Required;
    }

    /// <summary>A map extension field's key: its type, and what a reference key points to.</summary>
    public sealed class ExtensionKeyDecl
    {
        public string Type;
        public string To;
    }

    /// <summary>Closed-caption config (#214): the open/close cue delimiters, plus a `Character` whose whole
    /// lines are pure captions (omitted when captions are off, delimiters or not).</summary>
    public sealed class CaptionDelimiters
    {
        public string Open = "[";
        public string Close = "]";
        public string Character;   // null => the default "SFX"
    }

    /// <summary>"embedded" (resolve strings per locale) or "ids" (emit beat IDs); sourceDebug embeds the
    /// source language for debug playback only.</summary>
    public sealed class Localisation
    {
        public string Mode = "embedded";
        public bool SourceDebug;
    }

    public sealed class Locales
    {
        public string Default = "en";
        public List<string> Included = new List<string>();
    }

    public sealed class Cast
    {
        public string Name;
        public string DisplayName;
        /// <summary>This character's own label with a qualifier, by the qualifier's `gameId`, in the source
        /// language (`vo` -> `Your thoughts`): only for the pairs the project overrides, each localised as the
        /// `speaker:&lt;name&gt;:&lt;gameId&gt;` string. Null when it overrides none.</summary>
        public Dictionary<string, string> QualifierLabels;
    }

    /// <summary>A speaker qualifier as the bundle ships it (`V.O.`, `O.S.`, `RADIO`): the `gameId` a line
    /// carries, and the authored name (the fallback when no `qualifier:&lt;gameId&gt;` string exists).</summary>
    public sealed class Qualifier
    {
        public string GameId;
        public string Name;
    }

    public sealed class PropertyDecl
    {
        public string Name;
        public string Type;          // boolean | number | string | flags | enum | quality
        public bool? Shared;
        public bool Temporary;
        public ExprValue Default;  // null => the type default
        public List<string> Values;  // enum
        public List<string> Stages;  // quality: the ORDERED stage ladder (order IS the meaning)
    }

    /// <summary>A property of a HOST scope (`@world`, ...): the game owns the value, the story reads it.
    /// Mirrors @patterkit/model's HostScopeDecl. `Default` seeds the self-backed bag when no host binds
    /// the scope; null means the type default.</summary>
    public sealed class HostScopeDecl
    {
        public string Name;
        public string Type;          // boolean | number | string | flags | enum | quality
        public List<string> Values;  // enum / flags
        public List<string> Stages;  // quality: the ordered stage ladder
        public ExprValue Default;
        public bool? Writable;
    }

    /// <summary>One scope in the project's host-scope registry. No `Declarations` = OPAQUE: any name is
    /// accepted and nothing is seeded.</summary>
    public sealed class HostScopeSpec
    {
        public string Token;         // the token after '@', e.g. "world"
        public bool? Writable;
        public List<HostScopeDecl> Declarations;
    }

    /// <summary>The project's declared host scopes, baked into the bundle (design/scope-registry.md §6).
    /// A runtime that ignores this reads `@world.x` as a graceful false and plays a silently DIFFERENT
    /// story from the same bundle, which is what the conformance case `a declared host scope with no
    /// resolver is self-backed from its defaults` exists to catch.</summary>
    public sealed class HostScopeRegistry
    {
        public int Version = 1;
        public List<HostScopeSpec> Scopes = new List<HostScopeSpec>();
    }

    public sealed class Scene
    {
        public string Id;
        public string Name;
        public string GameId;
        public List<Block> Blocks = new List<Block>();
        public List<PropertyDecl> SceneProps = new List<PropertyDecl>();
        public List<Effect> OnEntry = new List<Effect>();
        public double? PadAfterDefault; // line padding: the default for the beats inside; null when none
        public GameData GameData;    // author overrides (raw, sparse); null when none
        /// <summary>Patter extension values: extension id -> field -> value, raw as authored (editor-only fields
        /// stripped), any JSON as a neutral tree (OrderedMap / List / bool / double / string / null). The engine
        /// never reads them. Null when the node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;    // author tags (#215)
    }

    public sealed class Block
    {
        public string Id;
        public string Name;
        public string GameId;
        public List<Node> Children = new List<Node>();
        public double? PadAfterDefault; // line padding: the default for the beats inside; null when none
        public GameData GameData;    // author overrides (raw, sparse); null when none
        /// <summary>Patter extension values: extension id -> field -> value, raw as authored (editor-only fields
        /// stripped), any JSON as a neutral tree (OrderedMap / List / bool / double / string / null). The engine
        /// never reads them. Null when the node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;    // author tags (#215)
    }

    /// <summary>A group (a run / choice / selector container) or a snippet (a run of beats).</summary>
    public sealed class Node
    {
        public string Id;
        public string Type;          // "group" | "snippet"

        // common
        public Expression Condition;
        public List<Effect> OnEnter;
        public List<Effect> OnExit;
        public double? PadAfterDefault; // line padding: the default for the beats inside; null when none
        public GameData GameData;
        /// <summary>Patter extension values: extension id -> field -> value, raw as authored (editor-only fields
        /// stripped), any JSON as a neutral tree (OrderedMap / List / bool / double / string / null). The engine
        /// never reads them. Null when the node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;    // author tags (#215)

        // option position (a direct child of a choice): an Option group or a bare snippet option
        public bool Sticky;
        public bool Fallback;
        public bool SecretUntilEligible;

        // group
        public string Selector;      // run (default) | choice | branch | sequence
        public List<Node> Children;
        public Beat Prompt;
        public SelectorOptions Options;
        public bool Shared;          // selector cursor shared across flows

        // snippet
        public List<Beat> Beats;
        public Jump Jump;

        public bool IsSnippet => Type == "snippet";
        public bool IsGroup => Type == "group";
    }

    public sealed class Beat
    {
        public string Id;
        public string Kind;          // line | text | gameEvent
        public string Character;
        public string Direction;
        public string Qualifier;     // speaker qualifier gameId (`vo`), line only; null when none
        /// <summary>The pause after this beat, before the next, in seconds (line and text only; negative = the
        /// next line cuts in). Null = the nearest `PadAfterDefault` above it, else the project's, else
        /// <see cref="Bundle.DefaultPadAfter"/>.</summary>
        public double? PadAfter;
        /// <summary>Text only: this beat is action, a direction for whoever stages the scene that the player
        /// never sees (`action: true`, set by the compiler on a dialogue scene's text when the project doesn't
        /// localise it; never on an option's prompt). Its text is the source in every locale. False = shown text.</summary>
        public bool Action;
        public GameData GameData;
        /// <summary>Patter extension values: extension id -> field -> value, raw as authored (editor-only fields
        /// stripped), any JSON as a neutral tree (OrderedMap / List / bool / double / string / null). The engine
        /// never reads them. Null when the node has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;    // author tags (#215)
    }

    public sealed class Jump
    {
        public string To;
        public string Mode;          // "call" => push return frame; else absolute jump
    }

    public sealed class Expression
    {
        public ExprNode Ast;
        /// <summary>The expression's source text as the author wrote it, when the bundle carries it (a
        /// content error report names it); null otherwise.</summary>
        public string Src;
    }

    public sealed class Effect
    {
        public string Target;        // a property ref
        public Expression Value;
    }

    public sealed class SelectorOptions
    {
        public string Order;         // sequential (default) | shuffle
        public string Exhaust;       // once (default) | repeat | stick
    }

    /// <summary>One author-defined gameData field: a declaration, as the kernel's ScopeDeclaration is (Name,
    /// Type, Values, a quality's Stages, Default), so the stage helpers take one as they take a property's:
    /// <c>Stages.Compare(field, line.GameData["act"], current)</c>. Type is the family's field list: text,
    /// multiline, number, boolean, enum, flags or quality.</summary>
    public sealed class GameDataField : ScopeDeclaration
    {
        /// <summary>What the field is for, in the author's words; null when they gave none.</summary>
        public string Purpose;
    }

    /// <summary>A node's sparse gameData overrides (name -> value).</summary>
    public sealed class GameData : Dictionary<string, ExprValue> { }
}
