/** Narrow an already typed union using its type discriminator; this does not perform arbitrary input validation.
 * @param {TType} type - Literal discriminator allowed by the declared union.
 * @param {TObject} object - Already typed borrowed value; arbitrary null/non-object input is outside this guard contract.
 * @returns {boolean} Whether the declared type matches; no nested validation, cloning or authorization occurs.
 */
// @__NO_SIDE_EFFECTS__
export function isOfType<
  const TType extends TObject['type'],
  const TObject extends { type: string },
>(type: TType, object: TObject): object is Extract<TObject, { type: TType }> {
  return object.type === type;
}
