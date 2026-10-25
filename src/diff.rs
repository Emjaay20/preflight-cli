use crate::inventory::Inventory;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InventoryDiff {
    pub from_version: String,
    pub to_version: String,
    pub permissions_added: Vec<String>,
    pub permissions_removed: Vec<String>,
    pub host_permissions_added: Vec<String>,
    pub host_permissions_removed: Vec<String>,
    pub destinations_added: Vec<String>,
    pub destinations_removed: Vec<String>,
    pub entrypoints_added: Vec<String>,
    pub entrypoints_removed: Vec<String>,
}

pub fn diff_inventories(old: &Inventory, new: &Inventory) -> InventoryDiff {
    InventoryDiff {
        from_version: old.version.clone(),
        to_version: new.version.clone(),
        permissions_added: added(&old.permissions, &new.permissions),
        permissions_removed: added(&new.permissions, &old.permissions),
        host_permissions_added: added(&old.host_permissions, &new.host_permissions),
        host_permissions_removed: added(&new.host_permissions, &old.host_permissions),
        destinations_added: added(&old.destinations, &new.destinations),
        destinations_removed: added(&new.destinations, &old.destinations),
        entrypoints_added: added(&old.entrypoints, &new.entrypoints),
        entrypoints_removed: added(&new.entrypoints, &old.entrypoints),
    }
}

fn added(old: &[String], new: &[String]) -> Vec<String> {
    let mut out: Vec<String> = new
        .iter()
        .filter(|item| !old.iter().any(|existing| existing == *item))
        .cloned()
        .collect();
    out.sort();
    out
}
