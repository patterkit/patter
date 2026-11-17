// Marks a MonoBehaviour field that takes a host scope, such as a World: in the Inspector, a GameObject dropped on
// it gives the component on it that implements IHostScope (a Patter World, or the game's own), and anything else
// is refused. The drawer is in the editor assembly. A component of your own with a World field (a director that
// makes its engine from a bundle) can use it too.

using UnityEngine;

namespace Patterkit.Patterplay
{
    public sealed class HostScopeFieldAttribute : PropertyAttribute { }
}
