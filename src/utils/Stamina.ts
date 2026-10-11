export type StaminaStatus = 'healthy' | 'winded' | 'dying' | 'dead';

/**
 * Helpers for the Draw Steel stamina thresholds.
 *
 * - A creature is *winded* when its stamina is equal to or less than half of its maximum.
 * - A hero is *dying* when its stamina is 0 or less, and *dead* once it reaches negative half its maximum.
 * - Any other creature is *dead* at 0 stamina.
 */
export class Stamina {
	/** The highest stamina value at which a creature is winded (half of max, rounded down). */
	public static windedThreshold(maxStamina: number): number {
		return Math.floor(maxStamina / 2);
	}

	/** The lowest stamina a hero can reach (negative half of max, rounded toward zero). Non-heroes bottom out at 0. */
	public static minimumStamina(maxStamina: number, isHero: boolean): number {
		return isHero ? -Math.floor(maxStamina / 2) : 0;
	}

	public static isWinded(currentStamina: number, maxStamina: number): boolean {
		return currentStamina > 0 && currentStamina <= Stamina.windedThreshold(maxStamina);
	}

	public static status(currentStamina: number, maxStamina: number, isHero: boolean): StaminaStatus {
		if (currentStamina <= Stamina.minimumStamina(maxStamina, isHero)) {
			return 'dead';
		}
		if (currentStamina <= 0) {
			return 'dying';
		}
		if (Stamina.isWinded(currentStamina, maxStamina)) {
			return 'winded';
		}
		return 'healthy';
	}
}
