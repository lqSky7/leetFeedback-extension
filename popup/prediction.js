/**
 * Prediction Algorithm for TUF Platform Task Scheduling
 * Implements the algorithm to predict which questions a user should solve next
 */

// Constants for focus modes
const FOCUS_MODES = {
  OnlyRevise: 0,
  FocusRevision: 1,
  FocusNew: 2,
  OnlyNew: 3,
};

/**
 * Helper function to clamp a value between bounds
 * @param {number} x - Value to clamp
 * @param {number} a - Lower bound (default: 0)
 * @param {number} b - Upper bound (default: 1)
 * @returns {number} Clamped value
 */
function clamp(x, a = 0, b = 1) {
  return Math.max(a, Math.min(b, x));
}

/**
 * Calculate days between two timestamps
 * @param {number} now_ms - Current timestamp in milliseconds
 * @param {number|null} past_ms - Past timestamp in milliseconds
 * @returns {number} Number of days between timestamps
 */
function daysBetween(now_ms, past_ms) {
  if (past_ms === null || past_ms === 0) return 0;
  return Math.max(0, Math.floor((now_ms - past_ms) / (1000 * 60 * 60 * 24)));
}

/**
 * Calculate revision score for a solved task
 * @param {number} now_ms - Current timestamp in milliseconds
 * @param {Object} task - Task object with solved properties
 * @returns {number} Revision score
 */
function scoreRevision(now_ms, task) {
  const ageDays = daysBetween(now_ms, task.solved.date);
  const A = clamp(ageDays / 30); // recency normalization
  const T = clamp((task.solved.tries ?? 0) / 5);
  const D = clamp(task.difficulty / 2);
  const epsilon = Math.random() * 0.0001; // small random noise for tie-breaking

  return 0.5 * A + 0.3 * T + 0.2 * D + epsilon;
}

/**
 * Split target count into revision and new quotas based on focus mode
 * @param {number} N - Target count
 * @param {number} mode - Focus mode (0-3)
 * @returns {Object} Object with rev and new quotas
 */
function splitQuota(N, mode) {
  switch (mode) {
    case FOCUS_MODES.OnlyRevise:
      return { rev: N, new: 0 };
    case FOCUS_MODES.FocusRevision:
      return { rev: Math.floor(0.7 * N), new: Math.floor(0.3 * N) };
    case FOCUS_MODES.FocusNew:
      return { rev: Math.floor(0.3 * N), new: Math.floor(0.7 * N) };
    case FOCUS_MODES.OnlyNew:
      return { rev: 0, new: N };
    default:
      return { rev: Math.floor(0.5 * N), new: Math.floor(0.5 * N) };
  }
}

/**
 * Max heap implementation for priority queue
 */
class MaxHeap {
  constructor() {
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  push(item) {
    this.heap.push(item);
    this.heapifyUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();

    const max = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.heapifyDown(0);
    return max;
  }

  heapifyUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].score >= this.heap[index].score) break;

      [this.heap[parentIndex], this.heap[index]] = [
        this.heap[index],
        this.heap[parentIndex],
      ];
      index = parentIndex;
    }
  }

  heapifyDown(index) {
    while (true) {
      let largest = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (
        leftChild < this.heap.length &&
        this.heap[leftChild].score > this.heap[largest].score
      ) {
        largest = leftChild;
      }

      if (
        rightChild < this.heap.length &&
        this.heap[rightChild].score > this.heap[largest].score
      ) {
        largest = rightChild;
      }

      if (largest === index) break;

      [this.heap[index], this.heap[largest]] = [
        this.heap[largest],
        this.heap[index],
      ];
      index = largest;
    }
  }
}

/**
 * Main scheduling algorithm
 * @param {Array} tasks - Array of task objects
 * @param {number} targetCount - Number of tasks to schedule
 * @param {number} focusMode - Focus mode (0-3)
 * @returns {Array} Array of scheduled tasks
 */
function scheduleToday(tasks, targetCount, focusMode, filters = {}) {
  const nowMs = Date.now();
  const { grandparent, parent_topic } = filters;

  // Helper function to check if task matches filters
  const matchesFilters = (task) => {
    if (grandparent) {
      // grandparent can be an array (multi-select) or a string (single select)
      if (Array.isArray(grandparent)) {
        if (grandparent.length > 0 && !grandparent.includes(task.grandparent)) return false;
      } else {
        if (task.grandparent !== grandparent) return false;
      }
    }
    if (parent_topic && task.parent_topic !== parent_topic) return false;
    return true;
  };

  // Build Queue A (NEW): strict FIFO by list order (unsolved and not ignored only)
  const newIndices = [];
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].solved.value === false && !tasks[i].ignored && matchesFilters(tasks[i])) {
      newIndices.push(i);
    }
  }

  // Build Queue B (REVISE): priority queue (max-heap) by score (solved and not ignored only)
  const revHeap = new MaxHeap();
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].solved.value === true && !tasks[i].ignored && matchesFilters(tasks[i])) {
      const score = scoreRevision(nowMs, tasks[i]);
      revHeap.push({ index: i, score: score });
    }
  }

  const { rev: revQuota, new: newQuota } = splitQuota(targetCount, focusMode);
  const result = [];

  // Take NEW strictly from the head of the FIFO list
  const takeNew = Math.min(newQuota, newIndices.length);
  for (let k = 0; k < takeNew; k++) {
    result.push(tasks[newIndices[k]]);
  }

  // Take REVISE by priority
  const takeRev = Math.min(revQuota, revHeap.size());
  for (let i = 0; i < takeRev; i++) {
    const top = revHeap.pop();
    if (top) {
      result.push(tasks[top.index]);
    }
  }

  // Fill leftovers without breaking FIFO for NEW
  let leftover = targetCount - result.length;
  if (leftover > 0) {
    // Try to fill from NEW first (still FIFO: continue from newIndices[takeNew])
    const moreNew = Math.min(leftover, newIndices.length - takeNew);
    for (let k = 0; k < moreNew; k++) {
      result.push(tasks[newIndices[takeNew + k]]);
    }
    leftover = targetCount - result.length;
  }

  if (leftover > 0) {
    // Then fill any remaining from REVISE by priority
    const remainingRev = Math.min(leftover, revHeap.size());
    for (let i = 0; i < remainingRev; i++) {
      const top = revHeap.pop();
      if (top) {
        result.push(tasks[top.index]);
      }
    }
  }

  return result;
}

/**
 * Toggle ignore status for a task
 * @param {Array} tasks - Array of task objects
 * @param {number} taskIndex - Index of task to toggle
 * @returns {boolean} New ignored status
 */
function toggleTaskIgnore(tasks, taskIndex) {
  if (taskIndex < 0 || taskIndex >= tasks.length) {
    throw new Error("Invalid task index");
  }

  tasks[taskIndex].ignored = !tasks[taskIndex].ignored;
  return tasks[taskIndex].ignored;
}

/**
 * Get statistics including ignored tasks
 * @param {Array} tasks - Array of task objects
 * @returns {Object} Statistics object
 */
function getTaskStatistics(tasks) {
  const total = tasks.length;
  const ignored = tasks.filter((task) => task.ignored).length;
  const active = total - ignored;
  const solved = tasks.filter(
    (task) => task.solved.value === true && !task.ignored,
  ).length;
  const unsolved = tasks.filter(
    (task) => task.solved.value === false && !task.ignored,
  ).length;
  const solvedIgnored = tasks.filter(
    (task) => task.solved.value === true && task.ignored,
  ).length;
  const unsolvedIgnored = tasks.filter(
    (task) => task.solved.value === false && task.ignored,
  ).length;

  return {
    total,
    active,
    ignored,
    solved,
    unsolved,
    solvedIgnored,
    unsolvedIgnored,
  };
}

/**
 * Load tasks from data.json and schedule based on parameters
 * @param {number} targetCount - Number of tasks to schedule (default: 5)
 * @param {number} focusMode - Focus mode 0-3 (default: 1 - FocusRevision)
 * @returns {Promise<Array>} Promise that resolves to scheduled tasks
 */
async function loadAndScheduleTasks(
  targetCount = 5,
  focusMode = FOCUS_MODES.FocusRevision,
) {
  try {
    const response = await fetch("../data.json");
    const tasks = await response.json();
    return scheduleToday(tasks, targetCount, focusMode);
  } catch (error) {
    console.error("Error loading tasks:", error);
    return [];
  }
}

/**
 * Get focus mode name from number
 * @param {number} mode - Focus mode number
 * @returns {string} Focus mode name
 */
function getFocusModeName(mode) {
  const modeNames = {
    [FOCUS_MODES.OnlyRevise]: "OnlyRevise",
    [FOCUS_MODES.FocusRevision]: "FocusRevision",
    [FOCUS_MODES.FocusNew]: "FocusNew",
    [FOCUS_MODES.OnlyNew]: "OnlyNew",
  };
  return modeNames[mode] || "Unknown";
}

// Export functions for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scheduleToday,
    loadAndScheduleTasks,
    FOCUS_MODES,
    getFocusModeName,
    clamp,
    daysBetween,
    scoreRevision,
    splitQuota,
    toggleTaskIgnore,
    getTaskStatistics,
  };
}

// For browser usage
if (typeof window !== "undefined") {
  window.PredictionAlgorithm = {
    scheduleToday,
    loadAndScheduleTasks,
    FOCUS_MODES,
    getFocusModeName,
    clamp,
    daysBetween,
    scoreRevision,
    splitQuota,
    toggleTaskIgnore,
    getTaskStatistics,
  };
}