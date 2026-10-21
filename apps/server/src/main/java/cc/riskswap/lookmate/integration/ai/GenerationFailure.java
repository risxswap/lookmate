package cc.riskswap.lookmate.integration.ai;

import lombok.Getter;

/** Safe machine code only; never exposes supplier bodies or credentials. */
@Getter
public class GenerationFailure extends RuntimeException {
    private final String code;
    private final boolean uncertain;

    public GenerationFailure(String code, boolean uncertain) {
        super(code);
        this.code = code;
        this.uncertain = uncertain;
    }
}
