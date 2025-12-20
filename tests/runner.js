// Minimal BDD-style test runner for gjs -m
// Usage: gjs -m tests/runAll.js

const COLORS = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
};

let currentSuite = '';
const results = { passed: 0, failed: 0, skipped: 0 };
const failures = [];

/**
 * Define a test suite
 * @param {string} name - Suite name
 * @param {function} fn - Suite function containing it() calls
 */
export function describe(name, fn) {
    currentSuite = name;
    print(`\n${COLORS.bold}${name}${COLORS.reset}`);
    fn();
}

/**
 * Define a test case
 * @param {string} description - Test description
 * @param {function} fn - Test function
 */
export function it(description, fn) {
    try {
        fn();
        print(`  ${COLORS.green}\u2713${COLORS.reset} ${description}`);
        results.passed++;
    } catch (e) {
        print(`  ${COLORS.red}\u2717${COLORS.reset} ${description}`);
        failures.push({ suite: currentSuite, test: description, error: e.message || String(e) });
        results.failed++;
    }
}

/**
 * Skip a test
 * @param {string} description - Test description
 * @param {function} fn - Test function (not executed)
 */
export function skip(description, _fn) {
    print(`  ${COLORS.yellow}\u25CB${COLORS.reset} ${description} ${COLORS.dim}(skipped)${COLORS.reset}`);
    results.skipped++;
}

/**
 * Create an expectation for assertions
 * @param {*} actual - The actual value to test
 * @returns {object} Assertion methods
 */
export function expect(actual) {
    return {
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toEqual(expected) {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toBeNull() {
            if (actual !== null) {
                throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
            }
        },
        toBeUndefined() {
            if (actual !== undefined) {
                throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected truthy value, got ${JSON.stringify(actual)}`);
            }
        },
        toBeFalsy() {
            if (actual) {
                throw new Error(`Expected falsy value, got ${JSON.stringify(actual)}`);
            }
        },
        toContain(expected) {
            if (typeof actual === 'string') {
                if (!actual.includes(expected)) {
                    throw new Error(`Expected "${actual}" to contain "${expected}"`);
                }
            } else if (Array.isArray(actual)) {
                if (!actual.includes(expected)) {
                    throw new Error(`Expected array to contain ${JSON.stringify(expected)}`);
                }
            } else {
                throw new Error(`toContain requires string or array, got ${typeof actual}`);
            }
        },
        toMatch(regex) {
            if (!regex.test(actual)) {
                throw new Error(`Expected "${actual}" to match ${regex}`);
            }
        },
        toBeGreaterThan(expected) {
            if (!(actual > expected)) {
                throw new Error(`Expected ${actual} > ${expected}`);
            }
        },
        toBeGreaterThanOrEqual(expected) {
            if (!(actual >= expected)) {
                throw new Error(`Expected ${actual} >= ${expected}`);
            }
        },
        toBeLessThan(expected) {
            if (!(actual < expected)) {
                throw new Error(`Expected ${actual} < ${expected}`);
            }
        },
        toBeLessThanOrEqual(expected) {
            if (!(actual <= expected)) {
                throw new Error(`Expected ${actual} <= ${expected}`);
            }
        },
        toHaveLength(expected) {
            if (actual.length !== expected) {
                throw new Error(`Expected length ${expected}, got ${actual.length}`);
            }
        },
        toThrow(expectedMessage) {
            if (typeof actual !== 'function') {
                throw new Error('toThrow requires a function');
            }
            let threw = false;
            let thrownError = null;
            try {
                actual();
            } catch (e) {
                threw = true;
                thrownError = e;
            }
            if (!threw) {
                throw new Error('Expected function to throw');
            }
            if (expectedMessage && !thrownError.message?.includes(expectedMessage)) {
                throw new Error(`Expected error message to contain "${expectedMessage}", got "${thrownError.message}"`);
            }
        },
        not: {
            toBe(expected) {
                if (actual === expected) {
                    throw new Error(`Expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`);
                }
            },
            toBeNull() {
                if (actual === null) {
                    throw new Error('Expected non-null value');
                }
            },
            toBeTruthy() {
                if (actual) {
                    throw new Error(`Expected falsy value, got ${JSON.stringify(actual)}`);
                }
            },
            toContain(expected) {
                if (typeof actual === 'string' && actual.includes(expected)) {
                    throw new Error(`Expected "${actual}" not to contain "${expected}"`);
                } else if (Array.isArray(actual) && actual.includes(expected)) {
                    throw new Error(`Expected array not to contain ${JSON.stringify(expected)}`);
                }
            },
        },
    };
}

/**
 * Print test summary and exit with appropriate code
 */
export function printSummary() {
    print(`\n${'─'.repeat(50)}`);

    const total = results.passed + results.failed + results.skipped;
    print(`${COLORS.bold}Test Results:${COLORS.reset} ${total} tests`);
    print(`  ${COLORS.green}${results.passed} passed${COLORS.reset}`);
    if (results.failed > 0) {
        print(`  ${COLORS.red}${results.failed} failed${COLORS.reset}`);
    }
    if (results.skipped > 0) {
        print(`  ${COLORS.yellow}${results.skipped} skipped${COLORS.reset}`);
    }

    if (failures.length > 0) {
        print(`\n${COLORS.red}${COLORS.bold}Failures:${COLORS.reset}`);
        for (const f of failures) {
            print(`\n  ${COLORS.bold}${f.suite}${COLORS.reset}`);
            print(`    ${f.test}`);
            print(`    ${COLORS.red}${f.error}${COLORS.reset}`);
        }
    }

    print('');

    // Exit with error code if any tests failed
    if (results.failed > 0) {
        imports.system.exit(1);
    }
}

/**
 * Reset test state (useful for running multiple test files)
 */
export function resetState() {
    results.passed = 0;
    results.failed = 0;
    results.skipped = 0;
    failures.length = 0;
}
