from cv import __version__


def main() -> int:
    print(f"postureguard-cv OK (version {__version__})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())