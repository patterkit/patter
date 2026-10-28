// A new `@patter` property made from the effects editor's "+ set property" picker (the hands-on fixes
// review): typing a name nothing has offers "+ New property", and choosing it asks one thing, what kind of
// value the property holds. The three plain kinds are offered; a list, a set of flags, or a quality needs
// its values written out, which is the Properties page's job, so they aren't. Number is the default (the
// Properties page's own new row starts as one, and "set gold to gold + 1" is the common case).

import { dialogFrame, el } from "@wildwinter/app-shell";
import type { PropertyDecl, PropertyType } from "@patterkit/model";

/** The kinds the choice offers, in the order the buttons read (the default last, where the accent sits). */
export const NEW_PROPERTY_TYPES: ReadonlyArray<{ type: PropertyType; label: string }> = [
  { type: "string", label: "Text" },
  { type: "boolean", label: "True or false" },
  { type: "number", label: "Number" },
];

/** Ask what kind of value `@name` holds. Resolves the type, or null when the author backs out. */
export function askPropertyType(name: string): Promise<PropertyType | null> {
  return new Promise((resolve) => {
    let answer: PropertyType | null = null;
    const frame = dialogFrame({
      title: "New property",
      sub: `What kind of value does @${name} hold? You can change it on the Properties page.`,
      className: "confirm-dialog new-prop-dialog",
      onClose: () => resolve(answer),
    });
    const cancel = el("button", "btn confirm-btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => frame.close());
    frame.actions.append(cancel);
    let primary: HTMLButtonElement | null = null;
    for (const t of NEW_PROPERTY_TYPES) {
      const b = el("button", t.type === "number" ? "btn primary confirm-btn" : "btn confirm-btn", t.label);
      b.type = "button";
      b.dataset["type"] = t.type;
      b.addEventListener("click", () => { answer = t.type; frame.close(); });
      frame.actions.append(b);
      if (t.type === "number") primary = b;
    }
    frame.open();
    primary?.focus();
  });
}

/** The declarations with `@name` added as `type`, unless a property already has that name (ignoring case),
 *  which is then answered as it is. */
export function withNewProperty(props: readonly PropertyDecl[], name: string, type: PropertyType): { props: PropertyDecl[]; decl: PropertyDecl; added: boolean } {
  const have = props.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (have) return { props: [...props], decl: have, added: false };
  const decl: PropertyDecl = { name, type };
  return { props: [...props, decl], decl, added: true };
}
