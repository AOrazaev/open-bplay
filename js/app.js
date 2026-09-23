// Top-level wiring / bootstrap. Loaded last.

const courtCanvas = document.querySelector('#courtCanvas');
const redrawCourt = setupCourtCanvas(courtCanvas);

window.addEventListener('resize', () => redrawCourt());
