/** Sheet movement affects occlusion only; controls stay at the peek position. */
export function mapControlsPlacement(_shellBottom: number, _sheetTop: number, controlsHeight: number, clearTop: number, peekBottom = 232) {
  const bottom = peekBottom + 12
  return { bottom, hidden: _shellBottom - bottom - controlsHeight < clearTop }
}
