def preprocess(source: str) -> str:
    lines = source.splitlines()
    indent_stack = [0]
    out_lines = []


    INDENT_TOK = ">>>"
    DEDENT_TOK = "<<<"

    for raw in lines:
        stripped = raw.rstrip()
        if not stripped.strip() or stripped.lstrip().startswith("#"):
            out_lines.append(stripped.lstrip())
            continue

        expanded = stripped.expandtabs(4)
        indent = len(expanded) - len(expanded.lstrip(" "))
        content = expanded.lstrip(" ")

        if indent > indent_stack[-1]:
            indent_stack.append(indent)
            out_lines.append(INDENT_TOK)
            out_lines.append(content)
        elif indent < indent_stack[-1]:
            while indent_stack and indent < indent_stack[-1]:
                indent_stack.pop()
                out_lines.append(DEDENT_TOK)
            out_lines.append(content)
        else:
            out_lines.append(content)

   
    final = []
    for line in out_lines:
        if line.strip() == "flatline":
            while len(indent_stack) > 1:
                indent_stack.pop()
                final.append(DEDENT_TOK)
        final.append(line)

    return "\n".join(final)