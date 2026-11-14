/** Narrow an already typed schema/action/metadata union using its kind discriminator; this is not a runtime shape validator.
 * @param {TKind} kind - Literal discriminator allowed by the declared union.
 * @param {TObject} object - Already typed borrowed value; arbitrary null/non-object input is outside this guard contract.
 * @returns {boolean} Whether the declared kind matches; does not validate nested fields or grant permissions.
 */
// @__NO_SIDE_EFFECTS__
export function isOfKind<
  const TKind extends TObject['kind'],
  const TObject extends { kind: string },
>(kind: TKind, object: TObject): object is Extract<TObject, { kind: TKind }> {
  return object.kind === kind;
}
