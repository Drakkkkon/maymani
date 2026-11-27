package kz.drakkkkon.moesayty;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Фоновая проверка новых версий по расписанию Android. */
public class CheckJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            Notify.check(getApplicationContext());
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return false;
    }
}
