<!-- 
@file src/components/system/builder/logic-builder.svelte
@component Visual Conditional Logic Builder
 -->
<script lang="ts">
import { slide } from "svelte/transition";

interface Rule {
	id: string;
	field: string;
	operator: "eq" | "neq" | "gt" | "lt" | "contains" | "in";
	value: any;
}

interface LogicGroup {
	type: "AND" | "OR";
	rules: (Rule | LogicGroup)[];
}

import LogicBuilder from "./logic-builder.svelte";

let { value = $bindable<any>(), fields = [] } = $props<{
	fields: any[];
	value: any;
}>();

// Initialize if empty
$effect(() => {
	if (!value) {
		value = { type: "AND", rules: [] };
	}
});

const operators = [
	{ label: "Equals", value: "eq" },
	{ label: "Not Equals", value: "neq" },
	{ label: "Greater Than", value: "gt" },
	{ label: "Less Than", value: "lt" },
	{ label: "Contains", value: "contains" },
	{ label: "Is In", value: "in" },
];

function addRule(group: LogicGroup) {
	group.rules.push({
		id: Math.random().toString(36).substring(7),
		field: fields[0]?.db_fieldName || "",
		operator: "eq",
		value: "",
	});
}

function addGroup(group: LogicGroup) {
	group.rules.push({ type: "AND", rules: [] });
}

function removeRule(group: LogicGroup, index: number) {
	group.rules.splice(index, 1);
}

function toggleGroupType(group: LogicGroup) {
	group.type = group.type === "AND" ? "OR" : "AND";
}
</script>

{#if value}
	<div class="logic-group rounded-lg border border-surface-300 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-900/50">
		<div class="mb-4 flex items-center justify-between">
			<div class="flex items-center gap-2">
				<button 
					class="btn btn-sm px-3 font-bold {value.type === 'AND' ? 'preset-filled-primary-500' : 'preset-filled-secondary-500'}"
					onclick={() => toggleGroupType(value!)}
				>
					{value.type}
				</button>
				<span class="text-xs opacity-50 uppercase tracking-widest font-bold italic">Condition Group</span>
			</div>
			
			<div class="flex gap-2">
				<button class="btn btn-sm preset-tonal-surface" onclick={() => addRule(value!)}>
					<iconify-icon icon="mdi:plus" width="16"></iconify-icon>
					<span>Rule</span>
				</button>
				<button class="btn btn-sm preset-tonal-surface" onclick={() => addGroup(value!)}>
					<iconify-icon icon="mdi:group" width="16"></iconify-icon>
					<span>Sub-group</span>
				</button>
			</div>
		</div>

		<div class="space-y-3">
			{#each value.rules as rule, i (rule.id || i)}
				<div transition:slide={{ duration: 200 }}>
					{#if 'type' in rule}
						<!-- Recursive Group -->
						<div class="ml-6 border-l-2 border-primary-500/30 pl-4">
							<LogicBuilder bind:value={value.rules[i] as any} {fields} />
						</div>
					{:else}
						<!-- Single Rule -->
						<div class="flex flex-wrap items-center gap-2 rounded-md bg-white p-2 shadow-sm dark:bg-surface-800">
							<select bind:value={rule.field} class="select select-sm flex-1 min-w-[120px]">
								{#each fields as f}
									<option value={f.db_fieldName}>{f.label || f.db_fieldName}</option>
								{/each}
							</select>

							<select bind:value={rule.operator} class="select select-sm w-32">
								{#each operators as op}
									<option value={op.value}>{op.label}</option>
								{/each}
							</select>

							<input type="text" bind:value={rule.value} class="input input-sm flex-1 min-w-[100px]" placeholder="Value..." />

							<button class="btn-icon btn-icon-sm text-error-500 hover:bg-error-500/10" onclick={() => removeRule(value!, i)} aria-label="Remove Rule">
								<iconify-icon icon="mdi:close" width="18"></iconify-icon>
							</button>
						</div>
					{/if}
				</div>
			{/each}

			{#if value.rules.length === 0}
				<div class="py-8 text-center text-sm opacity-40 italic border-2 border-dashed border-surface-300 dark:border-surface-700 rounded-lg">
					No conditions defined. Click "Add Rule" to begin.
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.logic-group {
		transition: all 0.3s ease;
	}
</style>
