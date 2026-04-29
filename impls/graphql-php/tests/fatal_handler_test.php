<?php declare(strict_types=1);

// Verifies the shutdown handler registered by server.php turns a PHP fatal
// error into a JSON envelope instead of HTML. Regression test for the
// "invalid JSON from driver: Unexpected token '<', <br />" conformer errors
// the graphql-php driver used to produce when webonyx OOMed or otherwise
// fataled mid-request.

$serverPath = realpath(__DIR__ . '/../server.php');
if ($serverPath === false) {
    fwrite(STDERR, "server.php not found\n");
    exit(1);
}

$tests = 0;
$failures = [];

function assertEq(string $label, $expected, $actual, array &$failures): void
{
    if ($expected !== $actual) {
        $failures[] = sprintf(
            "%s: expected %s, got %s",
            $label,
            var_export($expected, true),
            var_export($actual, true)
        );
    }
}

function runInSubprocess(string $phpScript): array
{
    $cmd = [PHP_BINARY, '-d', 'display_errors=stderr', '-r', $phpScript];
    $process = proc_open(
        $cmd,
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes
    );
    if (!is_resource($process)) {
        throw new RuntimeException('failed to launch subprocess');
    }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($process);
    return [$stdout, $stderr];
}

// Case 1: server.php, when required and hit with E_USER_ERROR, emits JSON.
$tests++;
$script = sprintf(
    'require %s; trigger_error("simulated fatal", E_USER_ERROR);',
    var_export($serverPath, true)
);
[$stdout] = runInSubprocess($script);
$decoded = json_decode($stdout, true);
assertEq('case 1: stdout is valid JSON', JSON_ERROR_NONE, json_last_error(), $failures);
assertEq('case 1: has errors array', true, is_array($decoded['errors'] ?? null), $failures);
assertEq('case 1: has one error', 1, isset($decoded['errors']) ? count($decoded['errors']) : 0, $failures);
$msg = $decoded['errors'][0]['message'] ?? '';
assertEq(
    'case 1: message mentions fatal + simulated',
    true,
    str_contains($msg, 'fatal') && str_contains($msg, 'simulated fatal'),
    $failures
);
// The most important property: no HTML leaked.
assertEq(
    'case 1: stdout contains no HTML tags',
    false,
    str_contains($stdout, '<b>') || str_contains($stdout, '<br'),
    $failures
);

// Case 2: server.php required but NO fatal — shutdown handler is a no-op, stdout is empty.
$tests++;
$script = sprintf('require %s;', var_export($serverPath, true));
[$stdout, $stderr] = runInSubprocess($script);
assertEq('case 2: clean exit produces no output', '', $stdout, $failures);

// Case 3: display_errors is disabled for the loaded server.
$tests++;
$script = sprintf(
    'require %s; echo (ini_get("display_errors") === "" || ini_get("display_errors") === "0") ? "off" : "on";',
    var_export($serverPath, true)
);
[$stdout] = runInSubprocess($script);
assertEq('case 3: display_errors is off after registerFatalHandler', 'off', $stdout, $failures);

if (count($failures) > 0) {
    fwrite(STDERR, "FAIL: {$tests} tests, " . count($failures) . " failure(s)\n");
    foreach ($failures as $f) {
        fwrite(STDERR, "  - {$f}\n");
    }
    exit(1);
}

fwrite(STDOUT, "OK: {$tests} tests passed\n");
exit(0);
