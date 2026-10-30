"""Regression guards for the dashboard's viewport ownership."""
from html.parser import HTMLParser
from pathlib import Path
import unittest


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.parents, self.errors = [], {}, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        node = (tag, attrs.get('id'), attrs.get('class', ''))
        if node[1]:
            self.parents[node[1]] = self.stack[-1] if self.stack else None
        if tag not in {'meta', 'link', 'img', 'input', 'br', 'hr', 'source'}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1][0] != tag:
            self.errors.append(tag)
        else:
            self.stack.pop()


class DashboardStructureTests(unittest.TestCase):
    def setUp(self):
        self.tree = Structure()
        self.tree.feed((Path(__file__).parent / 'static/index.html').read_text())

    def test_document_containers_are_balanced(self):
        self.assertEqual(self.tree.errors, [])
        self.assertEqual(self.tree.stack, [])

    def test_quota_and_settings_have_independent_containers(self):
        self.assertEqual(self.tree.parents['usagePanel'][1], 'dashboard')
        self.assertEqual(self.tree.parents['settingsPage'][0], 'main')
        self.assertEqual(self.tree.parents['infoDialog'][0], 'main')


if __name__ == '__main__':
    unittest.main()
