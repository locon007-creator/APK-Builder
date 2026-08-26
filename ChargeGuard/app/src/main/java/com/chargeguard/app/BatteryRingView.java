package com.chargeguard.app;

import android.content.Context;
import android.graphics.*;
import android.view.View;

public class BatteryRingView extends View {
    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private int level = 0, low = 20, high = 85;
    private boolean charging = false, enabled = true;

    public BatteryRingView(Context context) {
        super(context);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        setContentDescription("Battery level");
    }

    public void setBattery(int level, boolean charging, int low, int high, boolean enabled) {
        this.level = Math.max(0, Math.min(100, level));
        this.charging = charging;
        this.low = low;
        this.high = high;
        this.enabled = enabled;
        setContentDescription("Battery " + this.level + " percent. " + status());
        invalidate();
    }

    private int accent() {
        if (!enabled) return Color.rgb(112, 126, 119);
        if (!charging && level <= low) return Color.rgb(242, 180, 76);
        if (charging && level >= high) return Color.rgb(255, 112, 101);
        return Color.rgb(56, 226, 141);
    }

    private String status() {
        if (!enabled) return "MONITORING OFF";
        if (!charging && level <= low) return "CHARGE NOW";
        if (charging && level >= high) return "DISCONNECT";
        return charging ? "CHARGING • PROTECTED" : "BATTERY • PROTECTED";
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth(), h = getHeight();
        float cx = w / 2f, cy = h / 2f;
        float stroke = Math.max(16f, w * .055f);
        float radius = Math.min(w, h) * .38f;
        RectF oval = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);

        track.setStyle(Paint.Style.STROKE);
        track.setStrokeWidth(stroke);
        track.setStrokeCap(Paint.Cap.ROUND);
        track.setColor(Color.rgb(35, 52, 44));
        canvas.drawArc(oval, -90, 360, false, track);

        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeWidth(stroke);
        arc.setStrokeCap(Paint.Cap.ROUND);
        arc.setColor(accent());
        arc.setShadowLayer(stroke * 1.2f, 0, 0, Color.argb(100, Color.red(accent()), Color.green(accent()), Color.blue(accent())));
        canvas.drawArc(oval, -90, 360f * level / 100f, false, arc);

        text.setTextAlign(Paint.Align.CENTER);
        text.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        text.setColor(Color.rgb(148, 162, 155));
        text.setTextSize(w * .045f);
        text.setLetterSpacing(.15f);
        canvas.drawText("BATTERY", cx, cy - w * .08f, text);

        text.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        text.setColor(Color.WHITE);
        text.setTextSize(w * .18f);
        text.setLetterSpacing(-.04f);
        canvas.drawText(level + "%", cx, cy + w * .075f, text);

        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        text.setColor(accent());
        text.setTextSize(w * .038f);
        text.setLetterSpacing(.09f);
        canvas.drawText(status(), cx, cy + w * .16f, text);
    }
}
