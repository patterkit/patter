// GENERATED - vendored from expr/ports/unreal/Fwd.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The kernel's types, declared and not defined, for Unreal / std C++. THE
// SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// For a header that NAMES a kernel type without needing its definition: an
// Unreal public header taking a std::shared_ptr<ScopeRegistry>, say. The
// kernel's inline namespace is its stamped ID (see Errors.h), so nothing
// outside the kernel can spell a forward declaration of its types; this file
// is how. It pulls in nothing that throws, so a game module built without
// exceptions can include it, where the full kernel needs bEnableExceptions.
// ---------------------------------------------------------------------------
#include "Errors.h"   // the kernel id tripwire, WILDWINTER_EXPR_VISIBLE, ExprError, RegistryError
// Compiled once per translation unit, and never beside a different kernel: Errors.h stops
// that build with an #error, and this copy then stays out of the way of the first.
#if !defined(WILDWINTER_EXPR_k11805ede_FWD_H) && WILDWINTER_EXPR_KERNEL == 0x11805ede
#define WILDWINTER_EXPR_k11805ede_FWD_H

namespace wildwinter { namespace expr { inline namespace k11805ede
{
    enum class ExprKind;
    struct ExprValue;
    template <typename K, typename V> class OrderedMap;
    struct AstNode;
    class WILDWINTER_EXPR_VISIBLE IScopeSource;
    class WILDWINTER_EXPR_VISIBLE FnScope;
    struct EvalContext;
    struct Dialect;
    class Mulberry32;
    struct ScopeDeclaration;
    struct BagChange;
    struct PropertyRow;
    class PropertyBag;
    class StateLogger;
    class WILDWINTER_EXPR_VISIBLE IScopeResolver;
    struct ScopePropertyRow;
    class ScopeRegistry;
}}} // namespace wildwinter::expr

#endif
