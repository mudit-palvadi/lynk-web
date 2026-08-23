const HIGH_WATER_MARK = 1024 * 1024;
const RESUME_WATER_MARK = 256 * 1024;

export class BackpressureController {
  #paused = false;

  get isPaused() {
    return this.#paused;
  }

  canSend(bufferedAmount) {
    if (this.#paused) {
      if (bufferedAmount <= RESUME_WATER_MARK) {
        this.#paused = false;
        return true;
      }
      return false;
    }
    if (bufferedAmount > HIGH_WATER_MARK) {
      this.#paused = true;
      return false;
    }
    return true;
  }
}
