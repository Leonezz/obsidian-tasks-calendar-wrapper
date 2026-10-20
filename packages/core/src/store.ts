/**
 * One immutable state at a time, and the listeners to tell when it is replaced. It keeps to the contract of React's
 * useSyncExternalStore: getSnapshot returns the same object until setState replaces it, and subscribe returns the
 * function that unsubscribes. Setting the state it has, the same object, tells no one.
 *
 * Listeners are told in the order they subscribed, and each reads the snapshot when it is told. A listener subscribed
 * or taken off while they are told counts from the next change. A state set while they are told waits until all of
 * them have heard of the change before; then they are told again. A listener that throws does not keep the others
 * from hearing: its error is thrown after them, or an AggregateError of all of them when more than one threw.
 */
export interface Store<S> {
	getSnapshot(): S;
	subscribe(listener: () => void): () => void;
	setState(next: S | ((state: S) => S)): void;
}

/** One subscription; the same function subscribed twice is two of them. */
interface Subscription {
	readonly listener: () => void;
}

export function createStore<S>(initial: S): Store<S> {
	let state = initial;
	let subscriptions: readonly Subscription[] = [];
	let telling = false;
	let changedMeanwhile = false;

	function tell(): void {
		if (telling) {
			changedMeanwhile = true;
			return;
		}
		telling = true;
		const errors: unknown[] = [];
		try {
			do {
				changedMeanwhile = false;
				for (const { listener } of subscriptions) {
					try {
						listener();
					} catch (error) {
						errors.push(error);
					}
				}
			} while (changedMeanwhile);
		} finally {
			telling = false;
		}
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, `${errors.length} listeners of a store threw`);
	}

	return {
		getSnapshot: () => state,
		subscribe(listener) {
			const subscription: Subscription = { listener };
			subscriptions = [...subscriptions, subscription];
			return () => {
				subscriptions = subscriptions.filter((other) => other !== subscription);
			};
		},
		setState(next) {
			const replacement = typeof next === "function" ? (next as (state: S) => S)(state) : next;
			if (replacement === state) return;
			state = replacement;
			tell();
		},
	};
}
