"""Load the ligis plugin as an importable package.

The plugin directory is named ``hermes-plugin`` — a hyphen is not valid in
a Python identifier, so the directory cannot be imported by name. Hermes
loads it through its own plugin machinery (which does not care about the
hyphen); this helper gives the standalone test scripts the same ability by
registering the directory under a valid alias.

    from _loader import chains, tools
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent
ALIAS = "ligis_plugin"

_MODULES = ("caphash", "chains", "schemas", "tools")


def load() -> types.ModuleType:
    """Import the plugin package under a valid module name and return it."""
    if ALIAS in sys.modules:
        return sys.modules[ALIAS]

    package = types.ModuleType(ALIAS)
    package.__path__ = [str(PLUGIN_DIR)]
    sys.modules[ALIAS] = package

    for name in _MODULES:
        spec = importlib.util.spec_from_file_location(
            f"{ALIAS}.{name}", PLUGIN_DIR / f"{name}.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[f"{ALIAS}.{name}"] = module
        spec.loader.exec_module(module)
        # Expose each submodule as an attribute of the package, so
        # `from _loader import chains` and `pkg.chains` both work.
        setattr(package, name, module)

    return package


load()

# Convenience re-exports for the test scripts.
caphash = sys.modules[f"{ALIAS}.caphash"]
chains = sys.modules[f"{ALIAS}.chains"]
schemas = sys.modules[f"{ALIAS}.schemas"]
tools = sys.modules[f"{ALIAS}.tools"]
