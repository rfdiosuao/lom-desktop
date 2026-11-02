package top.heang.lom.app;
import android.app.Activity;
import android.os.Bundle;
import android.widget.*;
public class ControlFixtureActivity extends Activity {
 private int clicks=0;
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  LinearLayout layout=new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(40,400,40,30);
  EditText input=new EditText(this); input.setHint("Lom control input"); input.setContentDescription("fixture-input");
  TextView label=new TextView(this); label.setText("Clicks: 0");
  Button button=new Button(this); button.setText("Fixture tap"); button.setContentDescription("fixture-tap"); button.setOnClickListener(v -> label.setText("Clicks: " + (++clicks)));
  layout.addView(input); layout.addView(button); layout.addView(label); setContentView(layout);
 }
}
