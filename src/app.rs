use crate::drag_reorder::{provide_drag_reorder, use_drag_reorder, UseDragReorderReturn};
use leptos::{ev, prelude::*};
use leptos_meta::*;
use leptos_meta::{provide_meta_context, Stylesheet, Title};
use leptos_router::{
    components::{Route, Router, Routes},
    StaticSegment,
};

#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();
    view! {
        <Stylesheet id="leptos" href="/style/output.css"/>
        // <Link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✋</text></svg>"/>
        <Router>
            <main>
                <Routes fallback=|| "Page not found.">
                    <Route path=StaticSegment("") view=Home/>
                </Routes>
            </main>
        </Router>
    }
}

#[component]
pub fn Home() -> impl IntoView {
    let panels = ["Hey", "What's up", "Another one", "Do it"]
        .iter()
        .enumerate()
        .map(|(i, title)| Panel {
            id: i as u32,
            title: title.to_string(),
        })
        .collect::<Vec<_>>();
    let panel_order = [RwSignal::new(
        panels
            .iter()
            .map(|Panel { id, .. }| id.to_string().into())
            .collect::<Vec<_>>(),
    )];
    let panels = RwSignal::new(panels);
    let column_refs = provide_drag_reorder(panel_order);

    let columns = panel_order
        .into_iter()
        .zip(column_refs)
        .map(|(ordering, column_ref)| {
            let column_items = move || {
                ordering
                    .read()
                    .iter()
                    .filter_map(|id| {
                        panels
                            .read()
                            .iter()
                            .find(|panel| &panel.id.to_string() == id)
                            .cloned()
                    })
                    .collect::<Vec<_>>()
            };

            view! {
                <div node_ref=column_ref class="column">
                    <For
                        each=column_items
                        key=|item| item.id
                        let:panel
                    >
                        <Panel id=panel.id title=panel.title />
                    </For>
                </div>
            }
        })
        .collect_view();

    let add_panel = {
        move |_: ev::MouseEvent| {
            let mut panels = panels.write();
            let next_id = panels.last().map(|item| item.id).unwrap_or(0) + 1;
            panels.push(Panel {
                id: next_id,
                title: format!("Panel #{next_id}"),
            });
            panel_order[0].update(|order| {
                order.insert(0, next_id.to_string().into());
            });
        }
    };

    view! {
        <Title text="Whoever Wants"/>

        <div class="root">
            <button on:click=add_panel>"Add Panel"</button>

            <div class="row">
                {columns}
            </div>
        </div>

    }
}

#[component]
fn Panel(id: u32, title: String) -> impl IntoView {
    let UseDragReorderReturn {
        node_ref,
        draggable,
        set_draggable,
        on_dragstart,
        on_dragend,
        is_dragging,
        ..
    } = use_drag_reorder(id.to_string());

    // Create a signal to track if this panel should be visible
    let is_visible = RwSignal::new(true);

    // When dragging starts, temporarily hide the original panel
    Effect::new(move |_| {
        if is_dragging.get() {
            is_visible.set(false);
        } else {
            is_visible.set(true);
        }
    });

    view! {
        <div
            node_ref=node_ref
            class="panel"
            class:panel--placeholder=move || !is_visible.get()
            style:opacity=move || if is_visible.get() { "1" } else { "0" }
            style:pointer-events=move || if is_dragging.get() { "none" } else { "auto" }
            draggable=move || draggable.get().then_some("true")
            on:dragstart=on_dragstart
            on:dragend=on_dragend
            on:mousedown=move |_| set_draggable(true)
        >
            {title}
        </div>
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Panel {
    id: u32,
    title: String,
}
