#!/usr/bin/env gjs -m
// Chronome Test Suite Entry Point
// Run with: gjs -m tests/runAll.js

import { printSummary } from './runner.js';

print('Chronome Test Suite');
print('='.repeat(50));

await import('./meetingServices.test.js');
await import('./formatting.test.js');
await import('./icalParser.test.js');
await import('./eventUtils.test.js');

printSummary();
