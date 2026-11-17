// The Unity half of the package (Runtime/Unity: PatterBundleAsset, PatterWorld, PatterRunnerBehaviour) uses the
// engine-free World binding (WorldBinding.cs), which isn't public API.

using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("Patterplay.Runtime.Unity")]
