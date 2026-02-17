@echo off
echo ================================================
echo Installing Computer Vision Dependencies
echo ================================================
echo.

REM Refresh environment variables to pick up Python PATH
call refreshenv.cmd 2>nul

echo Checking Python installation...
python --version
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Please restart your terminal and try again.
    pause
    exit /b 1
)

echo.
echo Upgrading pip...
python -m pip install --upgrade pip

echo.
echo Installing OpenCV...
python -m pip install opencv-python

echo.
echo Installing NumPy...
python -m pip install numpy

echo.
echo Installing SciPy...
python -m pip install scipy

echo.
echo Installing Ultralytics YOLO...
python -m pip install ultralytics

echo.
echo ================================================
echo Installation Complete!
echo ================================================
echo.
echo You can now run the benthic activity detection locally.
echo Close this window and try processing your videos again.
echo.
pause
