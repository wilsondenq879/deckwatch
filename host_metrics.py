"""Read-only macOS telemetry. Unsupported readings remain null, never invented."""
import ctypes
import re
import subprocess
import sys
import time


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=3).strip()


def memory_from_vm(text, total):
    match = re.search(r'page size of (\d+) bytes', text)
    if not match:
        raise ValueError('Missing page size')
    page = int(match[1])
    values = {key.strip('"'): int(value) for key, value in re.findall(r'^([^:\n]+):\s+(\d+)\.', text, re.M)}
    # Resident anonymous memory + wired + physical compressor, excluding purgeable cache.
    # Excludes file-backed cache; exposed as an estimate, not Apple's private app-memory metric.
    used = (values['Anonymous pages'] + values['Pages wired down'] + values['Pages occupied by compressor'] - values['Pages purgeable']) * page
    return {'totalBytes': total, 'usedBytes': max(0, min(total, used)), 'estimated': True}


def cpu_percent(before, after):
    if before is None:
        return None
    deltas = [(b - a) & 0xffffffff for a, b in zip(before, after)]
    total = sum(deltas)
    return round(100 * (total - deltas[2]) / total, 1) if total else None


class MacMetrics:
    def __init__(self):
        self.previous = None
        self.history = []
        self.lib = None
        if sys.platform == 'darwin':
            self.lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
            self.lib.mach_host_self.restype = ctypes.c_uint
            self.lib.host_statistics.argtypes = [ctypes.c_uint, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
            self.lib.host_statistics.restype = ctypes.c_int
            self.lib.mach_port_deallocate.argtypes = [ctypes.c_uint, ctypes.c_uint]

    def ticks(self):
        if not self.lib:
            raise OSError('macOS required')
        data = (ctypes.c_int * 4)()
        count = ctypes.c_uint(4)
        host = self.lib.mach_host_self()
        try:
            if self.lib.host_statistics(host, 3, data, ctypes.byref(count)):
                raise OSError('CPU counters unavailable')
            return [value & 0xffffffff for value in data]
        finally:
            task = ctypes.c_uint.in_dll(self.lib, 'mach_task_self_').value
            self.lib.mach_port_deallocate(task, host)

    def sample(self):
        value = {'updatedAt': time.time(), 'cpuPercent': None, 'memory': None, 'memoryPressure': None, 'errors': []}
        try:
            ticks = self.ticks()
            value['cpuPercent'] = cpu_percent(self.previous, ticks)
            self.previous = ticks
            if value['cpuPercent'] is not None:
                self.history = (self.history + [{'at': value['updatedAt'], 'value': value['cpuPercent']}])[-24:]
        except Exception:
            value['errors'].append('cpu')
        value['cpuHistory'] = list(self.history)
        try:
            total = int(command('/usr/sbin/sysctl', '-n', 'hw.memsize'))
            value['memory'] = memory_from_vm(command('/usr/bin/vm_stat'), total)
        except Exception:
            value['errors'].append('memory')
        try:
            level = int(command('/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level'))
            value['memoryPressure'] = {1: 'normal', 2: 'warning', 4: 'critical'}.get(level)
            if value['memoryPressure'] is None:
                value['errors'].append('pressure')
        except Exception:
            value['errors'].append('pressure')
        return value

    def run(self, collector):
        while not collector.stop.is_set():
            collector.update(hostMetrics=self.sample())
            collector.stop.wait(5)
