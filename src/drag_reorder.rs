use std::{collections::HashMap, ops};

use js_sys::{wasm_bindgen::JsValue, Function};
use leptos::{ev, html::ElementType, prelude::*, tachys::dom::event_target};
use send_wrapper::SendWrapper;
use web_sys::{
    wasm_bindgen::{prelude::Closure, JsCast},
    Element,
};

/// Indicates whether a panel is being hovered above or below
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HoverPosition {
    Above,
    Below,
}

impl ops::Not for HoverPosition {
    type Output = Self;
    fn not(self) -> Self::Output {
        match self {
            Self::Above => Self::Below,
            Self::Below => Self::Above,
        }
    }
}

/// Information about a panel being hovered over
#[derive(Clone, Debug, PartialEq, Eq)]
struct HoveredPanel {
    id: Oco<'static, str>,
    position: HoverPosition,
}

/// Information about the current hover state during drag operations
#[derive(Clone, Debug, PartialEq, Eq)]
struct HoverInfo {
    column_index: usize,
    panel: Option<HoveredPanel>,
}

/// Context for managing drag-reorder operations across multiple panels
#[derive(Clone)]
struct DragReorderContext {
    /// References to column DOM elements
    column_refs: Vec<Signal<Option<SendWrapper<web_sys::Element>>>>,
    /// Order of panels within each column
    panel_order: Vec<RwSignal<Vec<Oco<'static, str>>>>,
    /// ID of the panel currently being dragged
    active_dragged_panel: RwSignal<Option<Oco<'static, str>>>,
    /// Current hover information during drag
    hover_info: RwSignal<Option<HoverInfo>>,
    /// Map of panel IDs to their DOM elements
    panel_elements: RwSignal<HashMap<Oco<'static, str>, SendWrapper<web_sys::Element>>>,
}

/// Return type for the use_drag_reorder hook
pub struct UseDragReorderReturn<E, SetDraggable, OnDragStart, OnDragEnd>
where
    E: ElementType,
    E::Output: 'static,
    SetDraggable: Fn(bool) + Copy,
    OnDragStart: Fn(ev::DragEvent) + Clone,
    OnDragEnd: Fn(ev::DragEvent) + Clone,
{
    /// Node ref which should be assigned to the panel element
    pub node_ref: NodeRef<E>,
    /// Whether this panel is currently being dragged
    pub is_dragging: Signal<bool>,
    /// The current hover position relative to this panel
    #[allow(unused)]
    pub hover_position: Signal<Option<HoverPosition>>,
    /// Whether the panel is currently draggable
    pub draggable: Signal<bool>,
    /// Function to enable/disable draggability
    pub set_draggable: SetDraggable,
    /// Event handler for drag start
    pub on_dragstart: OnDragStart,
    /// Event handler for drag end
    pub on_dragend: OnDragEnd,
}

// Helper function to create and manage event handlers
fn create_event_handler<F>(element: &web_sys::Document, event_name: &str, handler: F) -> Function
where
    F: FnMut(web_sys::DragEvent) + 'static,
{
    let js_handler: Function = Closure::wrap(Box::new(handler) as Box<dyn FnMut(_)>)
        .into_js_value()
        .dyn_into()
        .unwrap();

    element
        .add_event_listener_with_callback_and_bool(event_name, &js_handler, false)
        .unwrap();

    js_handler
}

// Helper function to remove event handlers
fn remove_event_handler(
    element: &web_sys::Document,
    event_name: &str,
    handler: &Function,
) -> Result<(), JsValue> {
    element.remove_event_listener_with_callback(event_name, handler)
}

// Helper function to find panel position in columns
fn find_panel_position(
    panel_order: &[RwSignal<Vec<Oco<'static, str>>>],
    panel_id: &str,
) -> Option<(usize, usize)> {
    for (column_idx, column_signal) in panel_order.iter().enumerate() {
        let column_panels = column_signal.get_untracked();
        if let Some(row_idx) = column_panels.iter().position(|id| id.as_str() == panel_id) {
            return Some((column_idx, row_idx));
        }
    }
    None
}

// Helper function to find closest element
fn find_closest_element<T, F>(items: impl Iterator<Item = T>, distance_fn: F) -> (Option<T>, f64)
where
    F: Fn(&T) -> Option<f64>,
{
    items.fold((None, f64::INFINITY), |(closest, min_distance), item| {
        if let Some(distance) = distance_fn(&item) {
            if distance < min_distance {
                (Some(item), distance)
            } else {
                (closest, min_distance)
            }
        } else {
            (closest, min_distance)
        }
    })
}

trait Center {
    fn center_x(&self) -> f64;
    fn center_y(&self) -> f64;
    fn center(&self) -> Pos2;
}

#[derive(Clone, Copy, Debug)]
struct Pos2 {
    x: f64,
    y: f64,
}

impl From<&ev::DragEvent> for Pos2 {
    fn from(value: &ev::DragEvent) -> Self {
        Self {
            x: value.client_x() as f64,
            y: value.client_y() as f64,
        }
    }
}

impl Center for Element {
    fn center_x(&self) -> f64 {
        let rect = self.get_bounding_client_rect();
        rect.left() + rect.width() / 2.
    }
    fn center_y(&self) -> f64 {
        let rect = self.get_bounding_client_rect();
        rect.y() + rect.height() / 2.0
    }
    fn center(&self) -> Pos2 {
        let rect = self.get_bounding_client_rect();
        Pos2 {
            x: rect.left() + rect.width() / 2.,
            y: rect.y() + rect.height() / 2.0,
        }
    }
}

impl ops::Add<Pos2> for Pos2 {
    type Output = Pos2;
    fn add(self, rhs: Pos2) -> Self::Output {
        Pos2 {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl ops::Sub<Pos2> for Pos2 {
    type Output = Pos2;
    fn sub(self, rhs: Pos2) -> Self::Output {
        Pos2 {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

/// Registers a panel with drag reordering functionality
pub fn use_drag_reorder<E>(
    panel_id: impl Into<Oco<'static, str>>,
) -> UseDragReorderReturn<
    E,
    impl Fn(bool) + Copy,
    impl Fn(ev::DragEvent) + Clone,
    impl Fn(ev::DragEvent) + Clone,
>
where
    E: ElementType + 'static,
    E::Output: JsCast + Into<web_sys::Element> + Clone + 'static,
{
    let DragReorderContext {
        column_refs,
        panel_order,
        active_dragged_panel,
        hover_info,
        panel_elements,
        ..
    } = expect_context();

    // Ensure we have a static string ID
    let mut panel_id: Oco<'static, str> = panel_id.into();
    panel_id.upgrade_inplace();
    let node_ref = NodeRef::<E>::new();

    // Register panel element when mounted
    Effect::new({
        let panel_id = panel_id.clone();
        move |_| match node_ref.get() {
            Some(element) => {
                panel_elements
                    .write()
                    .insert(panel_id.clone(), SendWrapper::new(element.into()));
            }
            None => {
                panel_elements.write().remove(&panel_id);
            }
        }
    });

    // Clean up panel registration when unmounted
    on_cleanup({
        let panel_id = panel_id.clone();
        move || {
            panel_elements.write().remove(&panel_id);
        }
    });

    // Track whether this panel is being dragged
    let is_dragging = Signal::derive({
        let panel_id = panel_id.clone();
        move || active_dragged_panel.read().as_deref() == Some(panel_id.as_str())
    });

    // Calculate hover position for styling purposes
    let hover_position = Signal::derive({
        let panel_id = panel_id.clone();
        move || match &*hover_info.read() {
            Some(HoverInfo {
                panel: Some(hovered_panel),
                ..
            }) => {
                let current_dragged_panel = active_dragged_panel.read();
                let Some(dragged_panel_id) = &*current_dragged_panel else {
                    return None;
                };

                let is_hovering_this_panel = hovered_panel.id == panel_id.as_str();
                let is_being_dragged = dragged_panel_id == panel_id.as_str();

                if is_hovering_this_panel && !is_being_dragged {
                    Some(hovered_panel.position)
                } else {
                    None
                }
            }
            _ => None,
        }
    });

    // Draggable state management
    let draggable_state = RwSignal::new(false);
    let set_draggable = move |can_drag: bool| {
        draggable_state.set(can_drag);
    };

    // Store dragover event handler for cleanup
    let dragover_handler: RwSignal<Option<Function>, LocalStorage> = RwSignal::new_local(None);

    // Handle drag start
    let on_drag_start = {
        let panel_id = panel_id.clone();
        move |event: ev::DragEvent| {
            active_dragged_panel.set(Some(panel_id.clone()));
            let active_dragged_panel_copy = panel_id.clone();

            let dragged_element = event_target::<web_sys::HtmlElement>(&event);
            let element_center = dragged_element.center();
            let dragged_height = dragged_element.get_bounding_client_rect().height();
            let mouse_offset = Pos2::from(&event) - element_center;

            // Set data transfer (required for Firefox drag events)
            if let Some(data_transfer) = event.data_transfer() {
                let _ = data_transfer.set_data("text/plain", &panel_id);
            }

            // Create dragover handler
            let column_refs = column_refs.clone();
            let panel_order = panel_order.clone();
            let dragover_fn =
                create_event_handler(&document(), "dragover", move |event: web_sys::DragEvent| {
                    event.prevent_default();

                    let adjusted_mouse = Pos2::from(&event) - mouse_offset;

                    // Find closest column to mouse position
                    let (closest_column, _) =
                        find_closest_element(column_refs.iter().enumerate(), |(_, column_ref)| {
                            column_ref.read_untracked().as_ref().map(|column_element| {
                                (adjusted_mouse.x - column_element.center_x()).abs()
                            })
                        });

                    // If we found a closest column, find the closest panel in that column
                    if let Some((column_index, _)) = closest_column {
                        let panel_elements = panel_elements.read_untracked();
                        let (closest_panel, _) = {
                            find_closest_element(
                                panel_elements.iter().filter(|(panel_id, _)| {
                                    **panel_id != active_dragged_panel_copy
                                }),
                                |(panel_id, panel_element)| {
                                    // Check if panel is in the target column
                                    let is_in_column = panel_order
                                        .get(column_index)
                                        .map(|column_panels| {
                                            column_panels.read_untracked().contains(panel_id)
                                        })
                                        .unwrap_or(false);

                                    if !is_in_column {
                                        return None;
                                    }
                                    Some((adjusted_mouse.y - panel_element.center_y()).abs())
                                },
                            )
                        };

                        // Determine hover position based on closest panel
                        let new_hover_info = if let Some((panel_id, _, panel_center_y)) =
                            closest_panel.map(|(k, v)| (k.clone(), v.clone(), v.center_y()))
                        {
                            let position = if let Some(previous_position) = hover_info
                                .get_untracked()
                                .and_then(|i| i.panel)
                                .filter(|panel| panel.id == panel_id)
                                .map(|p| p.position)
                            {
                                if (adjusted_mouse.y - panel_center_y).abs() < (dragged_height / 2.)
                                {
                                    !previous_position
                                } else {
                                    previous_position
                                }
                            } else {
                                if adjusted_mouse.y < panel_center_y {
                                    HoverPosition::Above
                                } else {
                                    HoverPosition::Below
                                }
                            };

                            Some(HoverInfo {
                                column_index,
                                panel: Some(HoveredPanel {
                                    id: panel_id,
                                    position,
                                }),
                            })
                        } else {
                            // No panel found, just hover over the column
                            Some(HoverInfo {
                                column_index,
                                panel: None,
                            })
                        };

                        // Update hover info only if it changed
                        hover_info.maybe_update(move |current_hover| {
                            if current_hover != &new_hover_info {
                                *current_hover = new_hover_info;
                                true
                            } else {
                                false
                            }
                        });
                    }
                });

            // Store handler for cleanup
            dragover_handler.set(Some(dragover_fn));
        }
    };

    // Handle drag end
    let on_drag_end = {
        let panel_id = panel_id.clone();
        move |_: ev::DragEvent| {
            // Remove dragover event listener
            if let Some(handler) = dragover_handler.write().take() {
                let _ = remove_event_handler(&document(), "dragover", &handler);
            }

            // Reset drag state on next animation frame
            let panel_id = panel_id.clone();
            request_animation_frame(move || {
                let mut current = active_dragged_panel.write();
                if current.as_deref() == Some(&panel_id) {
                    hover_info.set(None);
                    draggable_state.set(false);
                    *current = None;
                }
            });
        }
    };

    UseDragReorderReturn {
        node_ref,
        is_dragging,
        hover_position,
        draggable: draggable_state.into(),
        set_draggable,
        on_dragstart: on_drag_start,
        on_dragend: on_drag_end,
    }
}

/// Provides drag-reorder context for a fixed number of columns
pub fn provide_drag_reorder<const COLUMNS: usize, E>(
    panel_order: [RwSignal<Vec<Oco<'static, str>>>; COLUMNS],
) -> [NodeRef<E>; COLUMNS]
where
    E: ElementType + 'static,
    E::Output: JsCast + Into<web_sys::Element> + Clone + 'static,
{
    // Create node refs for each column
    let column_refs: Vec<NodeRef<E>> = panel_order
        .iter()
        .map(|_| NodeRef::new())
        .collect::<Vec<_>>();

    // Create drag reorder context
    let context = DragReorderContext {
        panel_order: panel_order.to_vec(),
        column_refs: column_refs
            .clone()
            .into_iter()
            .map(|column_ref| {
                Signal::derive(move || {
                    column_ref
                        .get()
                        .map(|element| SendWrapper::new(element.into()))
                })
            })
            .collect(),
        active_dragged_panel: RwSignal::new(None),
        hover_info: RwSignal::new(None),
        panel_elements: RwSignal::new(HashMap::new()),
    };

    // Set up global dragend handler
    Effect::new({
        move |mut previous_dragend_handler: Option<Function>| {
            // Clean up previous handler if it exists
            if let Some(handler) = previous_dragend_handler.take() {
                let _ = remove_event_handler(&document(), "dragend", &handler);
            }

            // Create new dragend handler
            let dragend_handler =
                create_event_handler(&document(), "dragend", move |_: web_sys::DragEvent| {
                    // Apply panel reordering when drag ends
                    if let Some((dragged_panel_id, hover_info)) = context
                        .active_dragged_panel
                        .read_untracked()
                        .as_ref()
                        .zip(context.hover_info.get_untracked())
                    {
                        apply_panel_reordering(&panel_order, dragged_panel_id, hover_info);
                    }
                });

            // Clean up on component unmount
            on_cleanup({
                let handler = SendWrapper::new(dragend_handler.clone());
                move || {
                    let _ = remove_event_handler(&document(), "dragend", &handler.take());
                }
            });

            dragend_handler
        }
    });

    // Provide context to children
    provide_context(context.clone());

    // Apply live reordering during drag for visual feedback
    Effect::new(move |_| {
        let hover_info = context.hover_info.get();
        let dragged_panel_id = context.active_dragged_panel.get();

        if let (Some(hover_info), Some(dragged_panel_id)) = (hover_info, dragged_panel_id) {
            apply_panel_reordering(&panel_order, &dragged_panel_id, hover_info);
        }
    });

    // Convert Vec<NodeRef<E>> to [NodeRef<E>; COLUMNS]
    column_refs
        .try_into()
        .ok()
        .expect("column refs vector should match COLUMNS size")
}

/// Reorders panels based on drag operation
fn apply_panel_reordering(
    panel_order: &[RwSignal<Vec<Oco<'static, str>>>],
    dragged_panel_id: &str,
    hover_info: HoverInfo,
) {
    // Extract hover information
    let HoverInfo {
        column_index: target_column_index,
        panel: maybe_hovered_panel,
    } = hover_info;

    // Find the source column and position of the dragged panel
    let source_position = find_panel_position(panel_order, dragged_panel_id);

    // Proceed only if we found the dragged panel
    if let Some((source_column_index, source_row_index)) = source_position {
        // Get the target column's panels
        let target_column_signal = &panel_order[target_column_index];
        let mut target_column_panels = target_column_signal.get_untracked();

        // Determine where to insert the panel in the target column
        let insert_row_index = match maybe_hovered_panel {
            Some(HoveredPanel {
                id: hovered_panel_id,
                position: hover_position,
            }) => {
                // Find the hovered panel in the target column
                if let Some(hovered_row_index) = target_column_panels
                    .iter()
                    .position(|panel_id| panel_id.as_str() == hovered_panel_id)
                {
                    // Determine insertion index based on hover position
                    let mut insertion_index = match hover_position {
                        HoverPosition::Above => hovered_row_index,
                        HoverPosition::Below => hovered_row_index + 1,
                    };

                    // Adjust index if moving within the same column
                    if source_column_index == target_column_index
                        && source_row_index < insertion_index
                    {
                        insertion_index -= 1;
                    }

                    insertion_index
                } else {
                    // If hovered panel not found, insert at end
                    target_column_panels.len()
                }
            }
            None => {
                // No specific panel hovered, insert at end of column
                target_column_panels.len()
            }
        };

        // Remove panel from source column
        let source_column_signal = &panel_order[source_column_index];
        let mut source_column_panels = source_column_signal.get_untracked();
        source_column_panels.remove(source_row_index);

        if source_column_index == target_column_index {
            // Moving within the same column
            source_column_panels.insert(insert_row_index, Oco::from(dragged_panel_id.to_string()));
            source_column_signal.set(source_column_panels);
        } else {
            // Moving to a different column
            source_column_signal.set(source_column_panels);

            // Insert panel into target column
            target_column_panels.insert(insert_row_index, Oco::from(dragged_panel_id.to_string()));
            target_column_signal.set(target_column_panels);
        }
    }
}
