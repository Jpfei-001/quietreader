/// Prefer at least 1050 logical pixels of startup height when the monitor can fit it.
/// This is not a manual-resize minimum: short or narrow work areas still scale down.
/// A single scale preserves the portrait ratio without moving controls off-screen.
const COMFORTABLE_START_HEIGHT: f64 = 1050.0;

pub fn fit_initial_size(
    preferred: (f64, f64),
    minimum: (f64, f64),
    available: (f64, f64),
) -> (f64, f64) {
    let available = (available.0.max(1.0), available.1.max(1.0));
    let fit_scale = (available.0 / preferred.0).min(available.1 / preferred.1).min(1.0);
    let screen_scale = (available.0 * 0.85 / preferred.0)
        .min(available.1 * 0.85 / preferred.1)
        .min(1.0);
    let minimum_scale = (minimum.0 / preferred.0)
        .max(minimum.1 / preferred.1)
        .max(COMFORTABLE_START_HEIGHT / preferred.1)
        .min(1.0);
    let scale = screen_scale.max(minimum_scale).min(fit_scale);
    (
        (preferred.0 * scale).floor().max(1.0),
        (preferred.1 * scale).floor().max(1.0),
    )
}

#[cfg(test)]
mod tests {
    use super::fit_initial_size;
    const PREFERRED: (f64, f64) = (800.0, 1100.0);
    const MINIMUM: (f64, f64) = (400.0, 500.0);

    fn assert_fits(size: (f64, f64), available: (f64, f64)) {
        assert!(size.0 >= 1.0 && size.1 >= 1.0);
        assert!(size.0 <= available.0 && size.1 <= available.1);
        assert!(size.0 <= PREFERRED.0 && size.1 <= PREFERRED.1);
        assert!((size.0 / size.1 - PREFERRED.0 / PREFERRED.1).abs() < 0.005);
    }

    #[test]
    fn large_screen_caps_at_the_preferred_size() {
        assert_eq!(fit_initial_size(PREFERRED, MINIMUM, (1800.0, 1400.0)), PREFERRED);
    }

    #[test]
    fn different_screens_get_different_initial_sizes() {
        let small = fit_initial_size(PREFERRED, MINIMUM, (1334.0, 696.0));
        let full_hd = fit_initial_size(PREFERRED, MINIMUM, (1888.0, 1008.0));
        let large = fit_initial_size(PREFERRED, MINIMUM, (2528.0, 1368.0));
        assert_eq!(small, (506.0, 696.0));
        assert_eq!(full_hd, (733.0, 1008.0));
        assert_eq!(large, PREFERRED);
        assert!(small.0 < full_hd.0 && full_hd.0 < large.0);
        assert!(small.1 < full_hd.1 && full_hd.1 < large.1);
    }

    #[test]
    fn enough_room_never_shrinks_height_below_1050_for_the_85_percent_budget() {
        let available = (1400.0, 1200.0);
        let size = fit_initial_size(PREFERRED, MINIMUM, available);
        assert_fits(size, available);
        assert_eq!(size, (763.0, 1050.0));
        assert!(size.1 > available.1 * 0.85);
    }

    #[test]
    fn short_screen_safely_relaxes_the_startup_height_floor() {
        let available = (1888.0, 1008.0);
        let size = fit_initial_size(PREFERRED, MINIMUM, available);
        assert_fits(size, available);
        assert_eq!(size.1, 1008.0);
    }

    #[test]
    fn narrow_screen_does_not_break_portrait_ratio_to_force_1050_height() {
        let available = (400.0, 1500.0);
        let size = fit_initial_size(PREFERRED, MINIMUM, available);
        assert_fits(size, available);
        assert_eq!(size, (400.0, 550.0));
    }

    #[test]
    fn dpi_is_accounted_for_in_logical_work_area() {
        let mut previous = PREFERRED;
        for density in [1.0, 1.25, 1.5, 2.0] {
            let available = (1920.0 / density - 32.0, 1040.0 / density - 32.0);
            let size = fit_initial_size(PREFERRED, MINIMUM, available);
            assert_fits(size, available);
            assert!(size.0 <= previous.0 && size.1 <= previous.1);
            previous = size;
        }
    }

    #[test]
    fn narrow_and_short_screens_preserve_ratio_and_relax_minimums_if_needed() {
        for available in [(700.0, 1500.0), (3400.0, 700.0), (400.0, 420.0), (180.0, 250.0)] {
            assert_fits(fit_initial_size(PREFERRED, MINIMUM, available), available);
        }
        let short = fit_initial_size(PREFERRED, MINIMUM, (700.0, 420.0));
        assert!(short.0 < MINIMUM.0 && short.1 < MINIMUM.1);
    }

    #[test]
    fn extremely_small_work_area_never_produces_zero_dimensions() {
        assert_eq!(fit_initial_size(PREFERRED, MINIMUM, (1.0, 1.0)), (1.0, 1.0));
    }
}
