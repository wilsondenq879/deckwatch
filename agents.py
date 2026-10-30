#!/usr/bin/env python3
"""Read-only adapters for the locally installed coding/agent runtimes.

The public snapshot intentionally contains bounded operational state only.  It
never returns prompts, message bodies, credentials, raw logs, or file paths.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


AGENT_NAMES = {
    'codex': 'Codex',
    'claude': 'Claude Code',
    'hermes': 'Hermes Agent',
    'openclaw': 'OpenClaw',
}


def _command_json(command, timeout=7):
    """Run a fixed, read-only CLI invocation and accept a bounded JSON result."""
    try:
        completed = subprocess.run(command, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
            timeout=timeout, check=False)
        if completed.returncode or len(completed.stdout) > 512_000:
            return None
        value = json.loads(completed.stdout)
        return value if isinstance(value, dict) else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _running(executable):
    """Best-effort process presence. It does not claim that an agent has a task."""
    name = Path(executable).name.lower().removesuffix('.exe')
    try:
        if sys.platform == 'win32':
            output = subprocess.check_output(['tasklist', '/FO', 'CSV', '/NH'],
                text=True, stderr=subprocess.DEVNULL, timeout=3)
            return any(line.split(',', 1)[0].strip('"').lower().removesuffix('.exe') == name
                       for line in output.splitlines())
        output = subprocess.check_output(['ps', '-ax', '-o', 'comm='], text=True,
            stderr=subprocess.DEVNULL, timeout=3)
        return any(Path(line.strip()).name.lower().removesuffix('.exe') == name
                   for line in output.splitlines())
    except (OSError, subprocess.SubprocessError):
        return False


def _record(agent, status, now, **extra):
    value = {'id': agent, 'name': AGENT_NAMES[agent], 'status': status,
             'updatedAt': now}
    value.update({key: item for key, item in extra.items() if item is not None})
    return value


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _first_number(value, *keys):
    if not isinstance(value, dict):
        return None
    for key in keys:
        number = _number(value.get(key))
        if number is not None:
            return number
    return None


class AgentFleet:
    """One read-only adapter per agent. Unsupported data is left unavailable."""
    def __init__(self, configuration=None):
        configuration = configuration if isinstance(configuration, dict) else {}
        self.configuration = configuration
        self.agents = configuration.get('agents') if isinstance(configuration.get('agents'), dict) else {}

    def enabled(self, agent):
        value = self.agents.get(agent, {})
        return not isinstance(value, dict) or value.get('enabled') is not False

    def settings(self, agent):
        value = self.agents.get(agent, {})
        return value if isinstance(value, dict) else {}

    def collect(self, codex_available=False, codex_error=False):
        now = time.time()
        rows = []
        if self.enabled('codex'):
            rows.append(_record('codex', 'ready' if codex_available else
                ('degraded' if codex_error else 'unavailable'), now,
                detail='read-only app-server'))
        if self.enabled('claude'):
            rows.append(self.claude(now))
        if self.enabled('hermes'):
            rows.append(self.hermes(now))
        if self.enabled('openclaw'):
            rows.append(self.openclaw(now))
        return rows

    def claude(self, now):
        executable = self.settings('claude').get('executable') or shutil.which('claude')
        if not executable:
            return _record('claude', 'unavailable', now, detail='CLI not found')
        # auth status is an explicitly documented, no-session command.  Do not
        # invoke Claude with a prompt just to populate a monitoring display.
        auth = _command_json([executable, 'auth', 'status'])
        running = _running(executable)
        if auth is None:
            return _record('claude', 'working' if running else 'available', now,
                detail='CLI detected')
        authenticated = auth.get('authMethod') not in (None, 'none')
        return _record('claude', 'working' if running else
            ('ready' if authenticated else 'degraded'), now,
            detail='background session detected' if running else
                   ('signed in' if authenticated else 'sign-in required'))

    def hermes(self, now):
        config = self.settings('hermes')
        executable = config.get('executable') or shutil.which('hermes')
        endpoint = config.get('statusUrl')
        if endpoint:
            headers = {'Accept': 'application/json'}
            token_name = config.get('tokenEnv')
            if isinstance(token_name, str) and os.environ.get(token_name):
                headers['Authorization'] = f'Bearer {os.environ[token_name]}'
            try:
                request = urllib.request.Request(endpoint, headers=headers)
                with urllib.request.urlopen(request, timeout=5) as response:
                    if response.status != 200 or int(response.headers.get('Content-Length', '0') or 0) > 512_000:
                        raise ValueError('status endpoint rejected')
                    payload = json.loads(response.read(512_000))
                if not isinstance(payload, dict):
                    raise ValueError('invalid status payload')
                active = _first_number(payload, 'activeSessions', 'active_sessions')
                gateway = payload.get('gateway') if isinstance(payload.get('gateway'), dict) else {}
                if active is None:
                    active = _first_number(gateway, 'activeSessions', 'active_sessions')
                status = 'working' if active and active > 0 else 'ready'
                return _record('hermes', status, now, activeSessions=active,
                    detail='dashboard status')
            except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
                return _record('hermes', 'degraded', now, detail='status endpoint unreachable')
        if not executable:
            return _record('hermes', 'unavailable', now, detail='agent not found')
        return _record('hermes', 'working' if _running(executable) else 'available', now,
            detail='local agent detected')

    def openclaw(self, now):
        executable = self.settings('openclaw').get('executable') or shutil.which('openclaw')
        if not executable:
            return _record('openclaw', 'unavailable', now, detail='gateway not found')
        health = _command_json([executable, 'health', '--json'])
        if health is None:
            return _record('openclaw', 'working' if _running(executable) else 'degraded', now,
                detail='gateway health unavailable')
        healthy = health.get('ok') is True
        sessions = health.get('sessions') if isinstance(health.get('sessions'), dict) else {}
        active = _first_number(sessions, 'active', 'activeCount', 'recentActivityCount')
        return _record('openclaw', 'working' if active and active > 0 else
            ('ready' if healthy else 'degraded'), now, activeSessions=active,
            detail='gateway health')
