import './style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #game not found');
}

const game = new Game(canvas);
game.start();
