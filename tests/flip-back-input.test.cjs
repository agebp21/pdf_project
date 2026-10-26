const assert = require('node:assert/strict');
global.window = {};
global.document = {addEventListener() {}, removeEventListener() {}};
require('../assets/export/layout.js');
const requests = []; let nativeClicks = 0, drags = 0, moves = 0;
const controller = {flip() { nativeClicks++; }, stopMove() { drags++; },
  getDirectionByPoint: () => 1, reset() {}, setState() {}};
const book = {flipPrev() {}, getFlipController: () => controller,
 getRender: () => ({convertToBook: p => p, finishAnimation() {},setBottomPage() {},setFlippingPage() {},clearShadow() {}}),
 userMove() {moves++;}, mfRequestTurn: value => requests.push(value)};
const stop = controller.stopMove, move = book.userMove;
global.FlipbookTurns.adopt(book);
controller.flip({x:0}); assert.deepEqual(requests,[false]);
assert.equal(controller.stopMove,stop,'interactive fold release remains native');
assert.equal(book.userMove,move,'page follows pointer during drag');
book.userMove(); controller.stopMove(); assert.equal(moves,1); assert.equal(drags,1);
book.mfRunningTurn=true; controller.flip({x:0}); assert.equal(nativeClicks,1);
console.log('PASS unified click, native interactive drag and release, recursion guard');
