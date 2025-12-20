#!/usr/bin/env gjs -m
// Chronome Test Suite Entry Point
// Run with: gjs -m tests/runAll.js

import { printSummary } from './runner.js';

print('Chronome Test Suite');
print('='.repeat(50));

// Import all test suites
import './meetingServices.test.js';
import './formatting.test.js';
import './icalParser.test.js';
import './eventUtils.test.js';

// Print final summary and exit with appropriate code
printSummary();
