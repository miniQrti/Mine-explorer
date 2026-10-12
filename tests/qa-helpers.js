/** Touch events go through Chromium's input subsystem, not application callbacks. */
export async function touchSession(page) {
  const client = await page.context().newCDPSession(page);
  const send = (type, points = []) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(({ x, y, id = 1 }) => ({ x, y, id, radiusX: 3, radiusY: 3, force: 1 })),
  });
  return { send, close: () => client.detach() };
}

export async function center(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible interactive tile');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function longPress(page, locator) {
  const point = await center(locator);
  const input = await touchSession(page);
  try {
    await input.send('touchStart', [point]);
    await page.waitForTimeout(650);
    await input.send('touchEnd');
  } finally { await input.close(); }
}

export async function touchDrag(page, locator) {
  const start = await center(locator);
  const input = await touchSession(page);
  try {
    await input.send('touchStart', [start]);
    await input.send('touchMove', [{ x: start.x + 25, y: start.y + 5 }]);
    await input.send('touchMove', [{ x: start.x + 65, y: start.y + 25 }]);
    await input.send('touchEnd');
  } finally { await input.close(); }
}

export async function touchPinch(page, locator) {
  const start = await center(locator);
  const input = await touchSession(page);
  try {
    await input.send('touchStart', [start]);
    await input.send('touchStart', [start, { x: start.x + 60, y: start.y, id: 2 }]);
    await input.send('touchMove', [
      { x: start.x - 20, y: start.y, id: 1 },
      { x: start.x + 85, y: start.y, id: 2 },
    ]);
    await input.send('touchEnd');
  } finally { await input.close(); }
}

export async function touchCancel(page, locator) {
  const point = await center(locator);
  const input = await touchSession(page);
  try {
    await input.send('touchStart', [point]);
    await input.send('touchCancel');
  } finally { await input.close(); }
}
