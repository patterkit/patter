// The Inspector field for a host scope (HostScopeFieldAttribute: the Patter Runner's World, say). Drop a
// GameObject on it and it takes the component on it that implements IHostScope (a Patter World, or the game's
// own), rather than Unity's pick, the GameObject's first component. Something with no such component is refused
// with a warning, and the field keeps what it had.

using UnityEditor;
using UnityEngine;

namespace Patterkit.Patterplay.Editor
{
    [CustomPropertyDrawer(typeof(HostScopeFieldAttribute))]
    public sealed class HostScopeFieldDrawer : PropertyDrawer
    {
        public override void OnGUI(Rect position, SerializedProperty property, GUIContent label)
        {
            if (property.propertyType != SerializedPropertyType.ObjectReference)
            {
                EditorGUI.LabelField(position, label.text, "HostScopeField takes a MonoBehaviour field");
                return;
            }
            EditorGUI.BeginProperty(position, label, property);
            EditorGUI.BeginChangeCheck();
            var picked = EditorGUI.ObjectField(position, label, property.objectReferenceValue, typeof(Object), true);
            if (EditorGUI.EndChangeCheck())
            {
                if (picked == null) property.objectReferenceValue = null;
                else
                {
                    var scope = Resolve(picked);
                    if (scope != null) property.objectReferenceValue = scope;
                    else Debug.LogWarning($"{picked.name} has no Patter World or IHostScope component, so it can't be the {label.text}.");
                }
            }
            EditorGUI.EndProperty();
        }

        /// <summary>The component a dropped object stands for: itself when it's a host scope, else the first one on
        /// its GameObject that is.</summary>
        private static MonoBehaviour Resolve(Object picked)
        {
            if (picked is MonoBehaviour mb && mb is IHostScope) return mb;
            GameObject go = picked as GameObject ?? (picked as Component)?.gameObject;
            return go != null ? go.GetComponent<IHostScope>() as MonoBehaviour : null;
        }
    }
}
