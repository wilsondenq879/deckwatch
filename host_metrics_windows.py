"""Read-only Windows host telemetry using the Win32 API (no Python packages)."""
import ctypes
from ctypes import wintypes
import time


class FILETIME(ctypes.Structure):
    _fields_ = [('dwLowDateTime', wintypes.DWORD), ('dwHighDateTime', wintypes.DWORD)]


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [('dwLength', wintypes.DWORD), ('dwMemoryLoad', wintypes.DWORD),
        ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
        ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
        ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
        ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]


def _time_value(value):
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


class WindowsMetrics:
    def __init__(self):
        self.previous = None
        self.history = []
        self.memory_history = []
        self.kernel32 = ctypes.windll.kernel32

    def sample(self):
        now = time.time()
        value = {'updatedAt': now, 'cpuPercent': None, 'memory': None,
                 'memoryPressure': None, 'errors': []}
        try:
            idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
            if not self.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                raise OSError('GetSystemTimes failed')
            current = (_time_value(idle), _time_value(kernel), _time_value(user))
            if self.previous:
                idle_delta = current[0] - self.previous[0]
                total_delta = (current[1] - self.previous[1]) + (current[2] - self.previous[2])
                if total_delta > 0:
                    value['cpuPercent'] = round(100 * (1 - idle_delta / total_delta), 1)
            self.previous = current
            if value['cpuPercent'] is not None:
                self.history = (self.history + [{'at': now, 'value': value['cpuPercent']}])[-24:]
        except Exception:
            value['errors'].append('cpu')
        value['cpuHistory'] = list(self.history)
        try:
            memory = MEMORYSTATUSEX()
            memory.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if not self.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
                raise OSError('GlobalMemoryStatusEx failed')
            value['memory'] = {'totalBytes': int(memory.ullTotalPhys),
                               'usedBytes': int(memory.ullTotalPhys - memory.ullAvailPhys),
                               'estimated': False}
        except Exception:
            value['errors'].append('memory')
        memory = value['memory']
        if memory and memory['totalBytes'] > 0:
            percent = max(0, min(100, memory['usedBytes'] / memory['totalBytes'] * 100))
            self.memory_history = (self.memory_history + [{'at': value['updatedAt'], 'value': round(percent, 2)}])[-24:]
        value['memoryHistory'] = list(self.memory_history)
        return value

    def run(self, collector):
        while not collector.stop.is_set():
            collector.update(hostMetrics=self.sample())
            collector.stop.wait(5)
