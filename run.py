import sys
from pathlib import Path
from interpreter import run_pulse


def main():
    if len(sys.argv) < 2:
        print("usage: python run.py <program.pulse> [--pulses]")
        sys.exit(1)

    path = Path(sys.argv[1])
    show_pulses = "--pulses" in sys.argv[2:]

    if not path.exists():
        print(f"error: file not found: {path}")
        sys.exit(1)

    source = path.read_text()
    output, pulses = run_pulse(source)

    print(f"=== output: {path.name} ===")
    for line in output:
        print(line)

    if show_pulses:
        print(f"\n=== pulse events ({len(pulses)}) ===")
        for kind, detail in pulses:
            print(f"  {kind:18} {detail}")


if __name__ == "__main__":
    main()