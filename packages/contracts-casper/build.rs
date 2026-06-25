//! Odra's contracts build script.

/// Uses the ENV variable `ODRA_MODULE` to set the `odra_module` cfg flag.
fn main() {
    odra_build::build();
}
